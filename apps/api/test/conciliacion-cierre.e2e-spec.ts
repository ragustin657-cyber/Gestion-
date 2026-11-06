import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararConciliacion } from './helpers-conciliacion';

describe('cierre, bloqueo y reapertura de conciliaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Depósito real de 53.000 (11/10) y gasto de 1.200 (20/10); extracto con el depósito, el impuesto (−318) y un renglón de saldo. */
  async function escenario(saldoFinal = 52682) {
    const t = await prepararConciliacion(app, prisma);
    const ing = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-10-05', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobro', cheques: [t.cheque(53000)], transferencias: [],
    });
    const dep = (await t.http.post('/api/tesoreria/depositos', { fecha: '2026-10-11', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, boleta: '0045', cheques: [ing.body.cheques[0].id] })).body;
    await t.http.post('/api/tesoreria/movimientos-bancarios', { fecha: '2026-10-20', cuentaBancariaId: t.ars.id, tipo: 'GASTO', cuentaContableId: await t.cuenta('5.2.02'), concepto: 'Comisión', importe: 1200 });
    await t.importar(t.csv(['11/10/2026;DEPOSITO;0045;53.000,00', '15/10/2026;IMP LEY 25413;;-318,00', '31/10/2026;SALDO DEL DIA;;99,00']));
    const c = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-10-01', hasta: '2026-10-31', saldoFinal })).body;
    const url = `/api/conciliacion/conciliaciones/${c.id}`;
    const linea = (concepto: string) => prisma.lineaExtracto.findFirstOrThrow({ where: { concepto } });
    const version = async () => (await prisma.conciliacion.findUniqueOrThrow({ where: { id: c.id } })).version;
    // Concilia el depósito con la sugerencia exacta
    const sug = (await t.http.post(`${url}/sugerencias`, {})).body;
    await t.http.post(`${url}/vinculos/lote`, { vinculos: sug });
    return { t, c, url, dep, linea, version };
  }

  it('no cierra con diferencia ni con líneas sin conciliar; registrando e ignorando, cierra', async () => {
    const mal = await escenario(52000);
    await mal.t.http.post(`${mal.url}/registrar`, { lineas: [{ lineaId: (await mal.linea('IMP LEY 25413')).id, cuentaContableId: await mal.t.cuenta('5.2.05'), concepto: 'Impuesto' }] });
    await mal.t.http.post(`${mal.url}/lineas/${(await mal.linea('SALDO DEL DIA')).id}/ignorar`, { motivo: 'Saldo' });
    const r = await mal.t.http.post(`${mal.url}/cerrar`, { version: await mal.version() });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La conciliación no cuadra: diferencia -$ 682,00');
    await limpiarBase(prisma);

    const { t, url, linea, version } = await escenario();
    const pend = await t.http.post(`${url}/cerrar`, { version: await version() });
    expect(pend.status).toBe(400);
    expect(pend.body.message).toBe('Hay 2 líneas del extracto sin conciliar');
    const imp = await linea('IMP LEY 25413');
    await t.http.post(`${url}/registrar`, { lineas: [{ lineaId: imp.id, cuentaContableId: await t.cuenta('5.2.05'), concepto: 'Impuesto 25.413' }] });
    await t.http.post(`${url}/lineas/${(await linea('SALDO DEL DIA')).id}/ignorar`, { motivo: 'Renglón informativo de saldo' });
    const ok = await t.http.post(`${url}/cerrar`, { version: await version() });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ estado: 'CERRADA' });
    expect(ok.body.resumen).toMatchObject({ diferencia: '0', pendientesSistema: '-1200' });
    expect(ok.body.cerradaEn).toBeTruthy();
    expect((await t.http.post(`${url}/vinculos`, { lineas: [imp.id], movimientos: [] })).body.message).toBe('La conciliación está cerrada');

    // El gasto pendiente pasa a noviembre
    const nov = (await t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 52682 })).body;
    expect(nov.saldoInicial).toBe('52682');
    const det = (await t.http.get(`/api/conciliacion/conciliaciones/${nov.id}`)).body;
    expect(det.movimientos.map((m: { importe: string }) => m.importe)).toEqual(['-1200']);
  });

  it('un depósito conciliado en un período cerrado no se anula; con la conciliación abierta se desvincula', async () => {
    const { t, dep, linea } = await escenario();
    // Abierta: la anulación libera el vínculo
    const a = await t.http.post(`/api/tesoreria/depositos/${dep.id}/anular`, { motivo: 'Prueba' });
    expect(a.status).toBe(200);
    expect((await linea('DEPOSITO')).estado).toBe('PENDIENTE');
    expect(await prisma.vinculoConciliacion.count()).toBe(0);

    // Cerrada: bloquea
    await limpiarBase(prisma);
    const e = await escenario();
    const imp = await e.linea('IMP LEY 25413');
    await e.t.http.post(`${e.url}/registrar`, { lineas: [{ lineaId: imp.id, cuentaContableId: await e.t.cuenta('5.2.05'), concepto: 'Impuesto' }] });
    await e.t.http.post(`${e.url}/lineas/${(await e.linea('SALDO DEL DIA')).id}/ignorar`, { motivo: 'Saldo' });
    expect((await e.t.http.post(`${e.url}/cerrar`, { version: await e.version() })).status).toBe(200);
    const b = await e.t.http.post(`/api/tesoreria/depositos/${e.dep.id}/anular`, { motivo: 'Prueba' });
    expect(b.status).toBe(400);
    expect(b.body.message).toBe('El movimiento está conciliado en la conciliación del período 01/10/2026–31/10/2026: reábrala para anularlo');
    expect((await prisma.depositoBancario.findUniqueOrThrow({ where: { id: e.dep.id } })).estado).toBe('CONFIRMADO');
    // Tampoco se registran movimientos con fecha conciliada
    const g = await e.t.http.post('/api/tesoreria/movimientos-bancarios', { fecha: '2026-10-15', cuentaBancariaId: e.t.ars.id, tipo: 'GASTO', cuentaContableId: await e.t.cuenta('5.2.02'), concepto: 'x', importe: 1 });
    expect(g.status).toBe(400);
    expect(g.body.message).toBe('La cuenta está conciliada hasta 31/10/2026');
  });

  it('reapertura: solo la última, con motivo y permiso de anular', async () => {
    const e = await escenario();
    const imp = await e.linea('IMP LEY 25413');
    await e.t.http.post(`${e.url}/registrar`, { lineas: [{ lineaId: imp.id, cuentaContableId: await e.t.cuenta('5.2.05'), concepto: 'Impuesto' }] });
    await e.t.http.post(`${e.url}/lineas/${(await e.linea('SALDO DEL DIA')).id}/ignorar`, { motivo: 'Saldo' });
    await e.t.http.post(`${e.url}/cerrar`, { version: await e.version() });
    const sinPermiso = await e.t.usuario(['conciliacion.operar'], null);
    expect((await sinPermiso.post(`${e.url}/reabrir`, { motivo: 'x' })).status).toBe(403);
    expect((await e.t.http.post(`${e.url}/reabrir`, {})).status).toBe(400);
    const nov = (await e.t.http.post('/api/conciliacion/conciliaciones', { cuentaBancariaId: e.t.ars.id, desde: '2026-11-01', hasta: '2026-11-30', saldoFinal: 0 })).body;
    const conOtra = await e.t.http.post(`${e.url}/reabrir`, { motivo: 'Error' });
    expect(conOtra.status).toBe(400);
    expect(conOtra.body.message).toBe('Solo se puede reabrir la última conciliación de la cuenta');
    await prisma.conciliacion.delete({ where: { id: nov.id } });
    const r = await e.t.http.post(`${e.url}/reabrir`, { motivo: 'Faltaba un débito' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'ABIERTA', motivoReapertura: 'Faltaba un débito' });
    expect(await prisma.auditoria.count({ where: { entidad: 'Conciliacion', entidadId: e.c.id, accion: 'MODIFICAR' } })).toBeGreaterThan(0);
  });
});
