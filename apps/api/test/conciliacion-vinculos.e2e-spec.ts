import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararConciliacion } from './helpers-conciliacion';

describe('conciliaciones y vínculos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Sistema: depósito 53.000 (11/10) y gasto 1.200 (20/10). Extracto: depósito 53.000 e impuesto −318. */
  async function escenario() {
    const t = await prepararConciliacion(app, prisma);
    const deposito = await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-10-11T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 53000, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    const g = await t.http.post('/api/tesoreria/movimientos-bancarios', {
      fecha: '2026-10-20', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'Comisión', importe: 1200,
    });
    const gasto = await prisma.movimientoTesoreria.findFirstOrThrow({ where: { origenId: g.body.id } });
    await t.importar(t.csv(['11/10/2026;DEPOSITO;0045;53.000,00', '15/10/2026;IMP LEY 25413;;-318,00']));
    const lineas = await prisma.lineaExtracto.findMany({ orderBy: { fecha: 'asc' } });
    const c = await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-01', hasta: '2026-10-31', saldoFinal: 52682 });
    if (c.status !== 201) throw new Error(JSON.stringify(c.body));
    return { t, deposito, gasto, lineas, conciliacion: c.body as { id: string } };
  }

  it('resumen de la conciliación', async () => {
    const { t, conciliacion } = await escenario();
    const r = (await t.http.get(`/api/conciliacion/conciliaciones/${conciliacion.id}`)).body;
    expect(r).toMatchObject({ estado: 'ABIERTA', saldoInicial: '0', saldoFinal: '52682' });
    expect(r.resumen).toMatchObject({ saldoSistema: '51800', pendientesSistema: '51800', pendientesExtracto: '52682', diferencia: '0' });
    expect(r.lineas).toHaveLength(2);
    expect(r.movimientos.map((m: { importe: string; descripcion: string }) => [m.importe, m.descripcion])).toEqual([['53000', 'Depósito'], ['-1200', 'Movimiento bancario']]);
  });

  it('vínculo manual, importes distintos, varios con varios y deshacer', async () => {
    const { t, deposito, gasto, lineas, conciliacion } = await escenario();
    const url = `/api/conciliacion/conciliaciones/${conciliacion.id}`;
    const mal = await t.http.post(`${url}/vinculos`, { lineas: [lineas[0].id], movimientos: [gasto.id] });
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Los importes no coinciden (extracto $ 53.000,00, sistema -$ 1.200,00)');
    const ok = await t.http.post(`${url}/vinculos`, { lineas: [lineas[0].id], movimientos: [deposito.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.tipo).toBe('MANUAL');
    expect((await prisma.lineaExtracto.findUniqueOrThrow({ where: { id: lineas[0].id } })).estado).toBe('CONCILIADA');
    let r = (await t.http.get(url)).body;
    expect(r.lineas).toHaveLength(1);
    expect(r.movimientos).toHaveLength(1);
    expect(r.vinculos).toHaveLength(1);
    expect(r.resumen.diferencia).toBe('0');
    expect((await t.http.delete(`${url}/vinculos/${ok.body.id}`)).status).toBe(200);
    r = (await t.http.get(url)).body;
    expect(r.lineas).toHaveLength(2);
    expect(r.vinculos).toHaveLength(0);

    // Dos líneas contra un movimiento
    await t.importar(t.csv(['12/10/2026;DEP PARTE 1;;30.000,00', '12/10/2026;DEP PARTE 2;;23.000,00']));
    const partes = await prisma.lineaExtracto.findMany({ where: { concepto: { startsWith: 'DEP PARTE' } } });
    expect((await t.http.post(`${url}/vinculos`, { lineas: partes.map((p) => p.id), movimientos: [deposito.id] })).status).toBe(201);
  });

  it('líneas y movimientos ajenos a la conciliación → 400', async () => {
    const { t, deposito, lineas, conciliacion } = await escenario();
    const url = `/api/conciliacion/conciliaciones/${conciliacion.id}`;
    await t.importar(t.csv(['05/11/2026;FUERA;;53.000,00']));
    const fuera = await prisma.lineaExtracto.findFirstOrThrow({ where: { concepto: 'FUERA' } });
    const r = await t.http.post(`${url}/vinculos`, { lineas: [fuera.id], movimientos: [deposito.id] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La línea no pertenece a esta conciliación');
    const posterior = await prisma.movimientoTesoreria.create({
      data: { empresaId: t.empresaId, fecha: new Date('2026-11-02T00:00:00Z'), tipo: 'INGRESO', cuentaBancariaId: t.ars.id, monedaCodigo: 'ARS', importe: 53000, origenTipo: 'DEPOSITO', origenId: randomUUID() },
    });
    const p = await t.http.post(`${url}/vinculos`, { lineas: [lineas[0].id], movimientos: [posterior.id] });
    expect(p.status).toBe(400);
    expect(p.body.message).toBe('El movimiento no pertenece a esta conciliación');
    expect((await t.http.post(`${url}/vinculos`, { lineas: [lineas[0].id], movimientos: [] })).status).toBe(400);
  });

  it('ignorar y restaurar una línea', async () => {
    const { t, lineas, conciliacion } = await escenario();
    const url = `/api/conciliacion/conciliaciones/${conciliacion.id}/lineas/${lineas[1].id}`;
    expect((await t.http.post(`${url}/ignorar`, {})).status).toBe(400);
    const i = await t.http.post(`${url}/ignorar`, { motivo: 'Renglón informativo' });
    expect(i.status).toBe(200);
    expect(i.body.estado).toBe('IGNORADA');
    expect((await t.http.post(`${url}/restaurar`, {})).body.estado).toBe('PENDIENTE');
  });

  it('una sola abierta por cuenta, períodos que no se superponen y saldo inicial propuesto', async () => {
    const { t, conciliacion } = await escenario();
    const otra = await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 0 });
    expect(otra.status).toBe(409);
    expect(otra.body.message).toBe('Ya hay una conciliación abierta para esta cuenta');
    // Simula el cierre de octubre
    await prisma.conciliacion.update({ where: { id: conciliacion.id }, data: { estado: 'CERRADA' } });
    const superpuesta = await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-15', hasta: '2026-11-30', saldoFinal: 0 });
    expect(superpuesta.status).toBe(409);
    expect(superpuesta.body.message).toBe('El período se superpone con la conciliación del 01/10/2026 al 31/10/2026');
    const nov = await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 0 });
    expect(nov.status).toBe(201);
    expect(nov.body.saldoInicial).toBe('52682');
    expect((await t.http.get(`/api/conciliacion/conciliaciones?cuentaBancariaId=${t.ars.id}`)).body).toHaveLength(2);
  });

  it('deshacer una importación con líneas conciliadas → 400; otra empresa → 404', async () => {
    const { t, deposito, lineas, conciliacion } = await escenario();
    await t.http.post(`/api/conciliacion/conciliaciones/${conciliacion.id}/vinculos`, { lineas: [lineas[0].id], movimientos: [deposito.id] });
    const imp = await prisma.importacionExtracto.findFirstOrThrow();
    expect((await t.http.post(`/api/conciliacion/importaciones/${imp.id}/deshacer`, {})).status).toBe(400);
    const otra = await prepararConciliacion(app, prisma);
    expect((await otra.http.get(`/api/conciliacion/conciliaciones/${conciliacion.id}`)).status).toBe(404);
  });

  it('dos vínculos simultáneos sobre el mismo movimiento: 201 y 409', async () => {
    const { t, deposito, conciliacion } = await escenario();
    await t.importar(t.csv(['13/10/2026;DEP OTRO;;53.000,00']));
    const [a, b] = await prisma.lineaExtracto.findMany({ where: { importe: 53000 } });
    const url = `/api/conciliacion/conciliaciones/${conciliacion.id}/vinculos`;
    const res = await Promise.all([t.http.post(url, { lineas: [a.id], movimientos: [deposito.id] }), t.http.post(url, { lineas: [b.id], movimientos: [deposito.id] })]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(res.find((x) => x.status === 409)!.body.message).toBe('El movimiento ya fue conciliado');
  });

  it('sugerencias automáticas y aplicación por lote', async () => {
    const { t, deposito, lineas, conciliacion } = await escenario();
    const url = `/api/conciliacion/conciliaciones/${conciliacion.id}`;
    const sug = await t.http.post(`${url}/sugerencias`, {});
    expect(sug.status).toBe(200);
    expect(sug.body).toEqual([{ lineas: [lineas[0].id], movimientos: [deposito.id], nivel: 'EXACTA', preseleccionada: true }]);
    const lote = await t.http.post(`${url}/vinculos/lote`, { vinculos: sug.body.map((x: { lineas: string[]; movimientos: string[] }) => ({ lineas: x.lineas, movimientos: x.movimientos })) });
    expect(lote.status).toBe(201);
    expect(lote.body).toEqual({ creados: 1 });
    expect((await prisma.lineaExtracto.findUniqueOrThrow({ where: { id: lineas[0].id } })).estado).toBe('CONCILIADA');
    expect((await prisma.vinculoConciliacion.findFirstOrThrow()).tipo).toBe('AUTOMATICO');
    expect((await t.http.post(`${url}/sugerencias`, {})).body).toEqual([]);
  });
});
