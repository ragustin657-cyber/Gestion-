import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: correcciones de la revisión (entrega 19)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    await s.empleado();
    const l = (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const ars = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await s.cuenta('1.1.01.002') })).body as { id: string };
    const asientos = () => prisma.asiento.count({ where: { empresaId: s.empresaId, origenTipo: 'LIQUIDACION_SUELDO' } });
    return { ...s, l, ars, asientos };
  };

  it('doble clic en cerrar, reabrir y contabilizar no duplica asientos', async () => {
    const x = await escenario();
    const cerrar = () => x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/cerrar`);
    expect((await Promise.all([cerrar(), cerrar()])).map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await x.asientos()).toBe(1);
    const reabrir = () => x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/reabrir`);
    expect((await Promise.all([reabrir(), reabrir()])).map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await x.asientos()).toBe(2);
    await cerrar();
    await prisma.liquidacion.update({ where: { id: x.l.id }, data: { asientoId: null } });
    const contabilizar = () => x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/contabilizar`);
    expect((await Promise.all([contabilizar(), contabilizar()])).map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await x.asientos()).toBe(4);
  });

  it('doble clic en anular un pago no lo revierte dos veces', async () => {
    const x = await escenario();
    await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/cerrar`);
    const p = (await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/pagos`, { fecha: '2026-11-30', cuentaBancariaId: x.ars.id })).body as { id: string };
    const anular = () => x.http.post(`/api/sueldos/pagos/${p.id}/anular`);
    expect((await Promise.all([anular(), anular()])).map((r) => r.status).sort()).toEqual([201, 400]);
    const pago = await prisma.pagoSueldos.findUniqueOrThrow({ where: { id: p.id } });
    expect(await prisma.asiento.count({ where: { anulaAId: pago.asientoId! } })).toBe(1);
  });

  it('pago desde caja con fecha anterior no deja la caja en negativo', async () => {
    const x = await escenario();
    await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/cerrar`);
    const suc = (await x.http.get('/api/tesoreria/sucursales')).body[0];
    const caja = (await x.http.post('/api/tesoreria/cajas', { nombre: 'Caja', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.001'), sucursalId: suc.id })).body as { id: string };
    const mov = (fecha: string, tipo: 'INGRESO' | 'EGRESO', importe: number) => prisma.movimientoTesoreria.create({ data: { empresaId: x.empresaId, fecha: new Date(`${fecha}T00:00:00Z`), tipo, cajaId: caja.id, monedaCodigo: 'ARS', importe, origenTipo: 'PRUEBA', origenId: caja.id } });
    await mov('2026-11-01', 'INGRESO', 1000000);
    await mov('2026-11-04', 'EGRESO', 900000);
    const r = await x.http.post(`/api/sueldos/liquidaciones/${x.l.id}/pagos`, { fecha: '2026-11-02', cajaId: caja.id });
    expect([r.status, r.body.message]).toEqual([400, 'Saldo insuficiente en la caja']);
  });
});
