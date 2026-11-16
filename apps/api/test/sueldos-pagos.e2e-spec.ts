import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

type Liq = { recibos: { id: string; empleadoId: string; legajo: number; pagado: boolean; neto: string }[]; pendientePago: string; pagos: { id: string; numero: number; importe: string; anulado: boolean }[] };

describe('sueldos: pagos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async (empleados = 1) => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const es = [];
    for (let i = 0; i < empleados; i++) es.push(await s.empleado());
    const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuentaBanco = await s.cuenta('1.1.01.002');
    const ars = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: cuentaBanco })).body as { id: string };
    const l = (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    await s.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: es[0].id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    const cerrar = () => s.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    const ver = async () => (await s.http.get(`/api/sueldos/liquidaciones/${l.id}`)).body as Liq;
    const pagar = (d: Record<string, unknown> = {}) => s.http.post(`/api/sueldos/liquidaciones/${l.id}/pagos`, { fecha: '2026-11-30', cuentaBancariaId: ars.id, ...d });
    return { ...s, es, ars, cuentaBanco, l, cerrar, ver, pagar };
  };

  it('pagar todos', async () => {
    const x = await escenario();
    await x.cerrar();
    const r = await x.pagar();
    expect(r.status).toBe(201);
    const v = await x.ver();
    expect(v.pendientePago).toBe('0.00');
    expect(v.recibos[0].pagado).toBe(true);
    const movs = await prisma.movimientoTesoreria.findMany({ where: { empresaId: x.empresaId, origenTipo: 'PAGO_SUELDOS' } });
    expect(movs.map((m) => [m.tipo, m.importe.toFixed(2), m.cuentaBancariaId])).toEqual([['EGRESO', '941016.82', x.ars.id]]);
    const pago = await prisma.pagoSueldos.findFirstOrThrow({ where: { empresaId: x.empresaId } });
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId: pago.asientoId! } });
    const sap = await x.cuenta('2.1.03.001');
    expect(rs.map((y) => [y.cuentaContableId, y.debe.toFixed(2), y.haber.toFixed(2)]).sort()).toEqual([[sap, '941016.82', '0.00'], [x.cuentaBanco, '0.00', '941016.82']].sort());
  });

  it('pagar algunos y luego el resto', async () => {
    const x = await escenario(2);
    await x.cerrar();
    const v0 = await x.ver();
    expect((await x.pagar({ reciboIds: [v0.recibos[0].id] })).status).toBe(201);
    expect((await x.ver()).recibos.map((r) => r.pagado)).toEqual([true, false]);
    expect((await x.pagar()).status).toBe(201);
    const v = await x.ver();
    expect(v.pagos.map((p) => p.importe)).toEqual([v0.recibos[0].neto, v0.recibos[1].neto]);
    expect(v.pendientePago).toBe('0.00');
    expect((await x.pagar()).body.message).toBe('No hay recibos pendientes de pago');
  });

  it('no paga dos veces', async () => {
    const x = await escenario();
    await x.cerrar();
    const id = (await x.ver()).recibos[0].id;
    const rs = await Promise.all([x.pagar({ reciboIds: [id] }), x.pagar({ reciboIds: [id] })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(rs.find((r) => r.status === 400)!.body.message).toBe('El recibo del legajo 1 ya está pagado');
    expect(await prisma.movimientoTesoreria.count({ where: { empresaId: x.empresaId, origenTipo: 'PAGO_SUELDOS' } })).toBe(1);
  });

  it('requisitos', async () => {
    const x = await escenario();
    expect((await x.pagar()).body.message).toBe('La liquidación no está cerrada');
  });

  it('anular y reabrir', async () => {
    const x = await escenario();
    await x.cerrar();
    await x.pagar();
    const reabrir = () => x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/reabrir`);
    expect((await reabrir()).body.message).toBe('La liquidación tiene pagos: anúlelos antes de reabrir');
    const pago = (await x.ver()).pagos[0];
    expect((await x.http.post(`/api/sueldos/pagos/${pago.id}/anular`)).status).toBe(201);
    expect(await prisma.movimientoTesoreria.count({ where: { empresaId: x.empresaId, origenTipo: 'PAGO_SUELDOS', anulado: true } })).toBe(1);
    const p = await prisma.pagoSueldos.findUniqueOrThrow({ where: { id: pago.id } });
    expect(await prisma.asiento.count({ where: { anulaAId: p.asientoId! } })).toBe(1);
    expect((await x.ver()).recibos[0].pagado).toBe(false);
    expect((await reabrir()).status).toBe(201);
  });

  it('cargas sociales', async () => {
    const x = await escenario();
    await x.cerrar();
    const ver = async () => (await x.http.get('/api/sueldos/cargas-sociales?anio=2026&mes=11')).body as { codigo: string; cuentaContableId: string; devengado: string; pagado: string; pendiente: string; detalle?: Record<string, string> }[];
    const filas = await ver();
    const cs = filas.find((f) => f.codigo === '2.1.03.002')!;
    expect(cs).toMatchObject({ devengado: '509739.11', pagado: '0.00', pendiente: '509739.11' });
    expect(cs.detalle).toEqual({ aportesSS: '163655.10', aportesOS: '35068.95', contribucionesSS: '209153.03', contribucionesOS: '70137.90', art: '30724.13', scvo: '1000.00' });
    expect(filas.find((f) => f.codigo === '2.1.03.003')).toMatchObject({ pendiente: '29224.13' });
    const pagar = (importe: number) => x.http.post('/api/sueldos/cargas-sociales/pagos', { anio: 2026, mes: 11, cuentaContableDeudaId: cs.cuentaContableId, importe, fecha: '2026-11-30', cuentaBancariaId: x.ars.id });
    const p = await pagar(509739.11);
    expect(p.status).toBe(201);
    expect((await ver()).find((f) => f.codigo === '2.1.03.002')!.pendiente).toBe('0.00');
    expect((await pagar(1)).body.message).toBe('El importe supera lo pendiente (pendiente $ 0,00)');
    expect((await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/reabrir`)).body.message).toBe('Hay pagos de cargas sociales de 11/2026: anúlelos antes de reabrir');
    expect((await x.http.post(`/api/sueldos/cargas-sociales/pagos/${p.body.id}/anular`)).status).toBe(201);
    expect((await ver()).find((f) => f.codigo === '2.1.03.002')!.pendiente).toBe('509739.11');
  });
});
