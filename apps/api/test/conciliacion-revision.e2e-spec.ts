import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararConciliacion } from './helpers-conciliacion';

describe('conciliación: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Depósito real de 53.000 (11/10) y gasto de 1.200 (20/10); extracto con el depósito y el impuesto −318. */
  async function octubre() {
    const t = await prepararConciliacion(app, prisma);
    const ing = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-10-05', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobro', cheques: [t.cheque(53000)], transferencias: [],
    });
    const dep = (await t.http.post('/api/tesoreria/depositos', { fecha: '2026-10-11', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, boleta: '0045', cheques: [ing.body.cheques[0].id] })).body;
    await t.http.post('/api/tesoreria/movimientos-bancarios', { fecha: '2026-10-20', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'Comisión', importe: 1200 });
    await t.importar(t.csv(['11/10/2026;DEPOSITO;0045;53.000,00', '15/10/2026;IMP LEY 25413;;-318,00']));
    const c = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-01', hasta: '2026-10-31', saldoFinal: 52682 })).body;
    const url = `/api/conciliacion/conciliaciones/${c.id}`;
    const imp = await prisma.lineaExtracto.findFirstOrThrow({ where: { concepto: 'IMP LEY 25413' } });
    const preparar = async () => {
      await t.http.post(`${url}/vinculos/lote`, { vinculos: (await t.http.post(`${url}/sugerencias`, {})).body });
      await t.http.post(`${url}/registrar`, { lineas: [{ lineaId: imp.id, cuentaContableId: await t.cuenta('5.2.05'), concepto: 'Impuesto' }] });
    };
    const version = async () => (await prisma.conciliacion.findUniqueOrThrow({ where: { id: c.id } })).version;
    return { t, c, url, dep, preparar, version };
  }

  it('una conciliación cerrada sigue mostrando diferencia cero después de conciliar sus pendientes en el período siguiente', async () => {
    const { t, url, preparar, version } = await octubre();
    await preparar();
    expect((await t.http.post(`${url}/cerrar`, { version: await version() })).status).toBe(200);
    await t.importar(t.csv(['03/11/2026;COMISION;;-1.200,00']));
    const nov = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 51482 })).body;
    const nurl = `/api/conciliacion/conciliaciones/${nov.id}`;
    const det = (await t.http.get(nurl)).body;
    await t.http.post(`${nurl}/vinculos`, { lineas: [det.lineas[0].id], movimientos: [det.movimientos[0].id] });
    const oct = (await t.http.get(url)).body;
    expect(oct.resumen.diferencia).toBe('0');
    expect(oct.movimientos.map((m: { importe: string }) => m.importe)).toEqual(['-1200']);
  });

  it('anular y cerrar a la vez nunca deja un movimiento conciliado anulado dentro de un período cerrado', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const { t, url, dep, preparar, version } = await octubre();
      await preparar();
      const v = await version();
      await Promise.all([
        t.http.post(`/api/tesoreria/depositos/${dep.id}/anular`, { motivo: 'Carrera' }),
        t.http.post(`${url}/cerrar`, { version: v }),
      ]);
      const c = await prisma.conciliacion.findFirstOrThrow();
      const d = await prisma.depositoBancario.findUniqueOrThrow({ where: { id: dep.id } });
      expect(c.estado === 'CERRADA' && d.estado === 'ANULADO').toBe(false);
      const anuladosVinculados = await prisma.movimientoTesoreria.count({ where: { anulado: true, vinculoId: { not: null } } });
      expect(anuladosVinculados).toBe(0);
    }
  });

  it('primera conciliación de una cuenta con historia previa: los movimientos anteriores se marcan como conciliados al inicio', async () => {
    const t = await prepararConciliacion(app, prisma);
    const previo = await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-07-10T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 5000000, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    const oct = await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-10-10T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 1000, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    await t.importar(t.csv(['10/10/2026;DEPOSITO;;1.000,00']));
    const c = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-01', hasta: '2026-10-31', saldoInicial: 5000000, saldoFinal: 5001000 })).body;
    const url = `/api/conciliacion/conciliaciones/${c.id}`;
    const linea = await prisma.lineaExtracto.findFirstOrThrow();
    await t.http.post(`${url}/vinculos`, { lineas: [linea.id], movimientos: [oct.id] });
    expect((await t.http.get(url)).body.resumen.diferencia).toBe('5000000');
    const ajeno = await t.http.post(`${url}/apertura`, { movimientos: [oct.id] });
    expect(ajeno.status).toBe(400);
    const r = await t.http.post(`${url}/apertura`, { movimientos: [previo.id] });
    expect(r.status).toBe(201);
    expect(r.body.tipo).toBe('APERTURA');
    expect((await t.http.get(url)).body.resumen.diferencia).toBe('0');
    const v = (await prisma.conciliacion.findUniqueOrThrow({ where: { id: c.id } })).version;
    expect((await t.http.post(`${url}/cerrar`, { version: v })).status).toBe(200);
    // En una conciliación que no es la primera no se permite
    const nov = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 5001000 })).body;
    const otro = await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-08-10T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 5, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    const segunda = await t.http.post(`/api/conciliacion/conciliaciones/${nov.id}/apertura`, { movimientos: [otro.id] });
    expect(segunda.status).toBe(400);
    expect(segunda.body.message).toBe('Solo la primera conciliación de la cuenta puede marcar movimientos como conciliados al inicio');
  });

  it('un período cerrado conserva sus partidas pendientes y no recibe líneas nuevas ni pierde las suyas', async () => {
    const { t, url, preparar, version } = await octubre();
    // Un depósito en tránsito queda pendiente al cierre
    const ing = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-10-28', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobro', cheques: [t.cheque(7000)], transferencias: [],
    });
    const enTransito = (await t.http.post('/api/tesoreria/depositos', { fecha: '2026-10-30', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [ing.body.cheques[0].id] })).body;
    await prisma.conciliacion.updateMany({ data: { saldoFinal: 52682 } });
    await t.importar(t.csv(['31/10/2026;SALDO DEL DIA;;99,00']));
    await preparar();
    const saldo = await prisma.lineaExtracto.findFirstOrThrow({ where: { concepto: 'SALDO DEL DIA' } });
    await t.http.post(`${url}/lineas/${saldo.id}/ignorar`, { motivo: 'Saldo' });
    expect((await t.http.post(`${url}/cerrar`, { version: await version() })).status).toBe(200);
    const antes = (await t.http.get(`${url}/reporte?formato=json`)).body;
    expect(antes.creditosNoAcreditados.map((x: { importe: string }) => x.importe)).toEqual(['7000']);
    // Anular en noviembre el depósito pendiente no cambia el reporte cerrado
    expect((await t.http.post(`/api/tesoreria/depositos/${enTransito.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    expect((await t.http.get(`${url}/reporte?formato=json`)).body.creditosNoAcreditados.map((x: { importe: string }) => x.importe)).toEqual(['7000']);
    // Un extracto con líneas de octubre: se omiten con aviso
    const imp = await t.importar(t.csv(['25/10/2026;OLVIDADA;;-50,00', '02/11/2026;NOVIEMBRE;;-60,00']));
    expect(imp.body.lineas).toBe(1);
    expect(imp.body.advertencias).toContain('Se omitieron 1 líneas de períodos ya conciliados (hasta 31/10/2026)');
    // No se puede deshacer una importación con líneas de un período cerrado
    const importacion = await prisma.importacionExtracto.findFirstOrThrow({ where: { items: { some: { id: saldo.id } } } });
    const d = await t.http.post(`/api/conciliacion/importaciones/${importacion.id}/deshacer`, {});
    expect(d.status).toBe(400);
    expect(d.body.message).toBe('La importación tiene líneas de un período ya conciliado y cerrado');
  });
});
