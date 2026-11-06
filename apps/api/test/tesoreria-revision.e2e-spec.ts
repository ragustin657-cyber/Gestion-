import { INestApplication } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

const enDias = (d: number) => {
  const f = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() + d);
  return f.toISOString().slice(0, 10);
};

describe('tesorería: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el flujo de fondos no cuenta dos veces un cheque depositado', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.http.post('/api/tesoreria/ingresos', {
      fecha: enDias(0), cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'x', cheques: [t.cheque(50000, { fechaPago: enDias(10) })], transferencias: [],
    });
    await t.http.post('/api/tesoreria/depositos', { fecha: enDias(0), cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [r.body.cheques[0].id] });
    const flujo = (await t.http.get('/api/tesoreria/flujo?dias=15')).body;
    expect(flujo[0].saldo).toBe('50000');
    expect(flujo[10].saldo).toBe('50000');
  });

  it('la visibilidad del cheque sigue a la sucursal donde está ahora', async () => {
    const t = await prepararTesoreria(app, prisma);
    const rosAceptar = await t.usuario(['tesoreria.ver', 'tesoreria.operar', 'tesoreria.aceptar'], t.ros.id);
    // CEN recibe un cheque y lo envía a ROS; ROS lo recibe, lo deposita y lo acredita
    const ing = await t.ingresar({ cheques: [t.cheque(1000)] });
    const chequeId = ing.cheques[0].id;
    const tr = (await t.http.post('/api/tesoreria/traslados', { fecha: '2026-11-11', cajaOrigenId: t.cajaCen.id, cajaDestinoId: t.cajaRos.id, cheques: [chequeId] })).body;
    expect((await rosAceptar.post(`/api/tesoreria/traslados/${tr.id}/recibir`, { fecha: '2026-11-11', items: tr.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })) })).status).toBe(200);
    expect((await rosAceptar.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaRos.id, cuentaBancariaId: t.ars.id, cheques: [chequeId] })).status).toBe(201);
    expect((await rosAceptar.get('/api/tesoreria/pendientes-acreditar')).body.cheques.map((c: { id: string }) => c.id)).toEqual([chequeId]);
    expect((await rosAceptar.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-13', cheques: [chequeId], transferencias: [] })).status).toBe(200);

    // ROS recibe un cheque y lo envía a CEN, que lo deposita: ROS ya no lo ve ni lo puede rechazar
    const ing2 = await t.ingresar({ cajaId: t.cajaRos.id, cheques: [t.cheque(2000)] }, rosAceptar);
    const otro = ing2.cheques[0].id;
    const tr2 = (await rosAceptar.post('/api/tesoreria/traslados', { fecha: '2026-11-11', cajaOrigenId: t.cajaRos.id, cajaDestinoId: t.cajaCen.id, cheques: [otro] })).body;
    await t.http.post(`/api/tesoreria/traslados/${tr2.id}/recibir`, { fecha: '2026-11-11', items: tr2.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })) });
    expect((await rosAceptar.get(`/api/tesoreria/cheques/${otro}`)).status).toBe(404);
    await t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [otro] });
    expect((await rosAceptar.post(`/api/tesoreria/cheques/${otro}/rechazar`, { fecha: '2026-11-15', motivo: 'x' })).status).toBe(404);
  });

  it('pagar una OP en efectivo respeta la sucursal y el saldo de la caja', async () => {
    const t = await prepararTesoreria(app, prisma);
    const fc = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 1000 });
    const b = await t.http.post('/api/pagos/ordenes', { terceroId: t.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: fc.movimientoId, importe: 1210 }] });
    const op = (await t.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version })).body;
    const medio = (cajaId: string) => [{ tipo: 'EFECTIVO', monedaCodigo: 'ARS', importe: 1210, cajaId }];
    const pagador = await t.usuario(['op.ver', 'pago.ejecutar'], t.ros.id);
    expect((await pagador.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago: '2026-11-15', medios: medio(t.cajaCen.id) })).status).toBe(404);
    const sinSaldo = await t.http.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago: '2026-11-15', medios: medio(t.cajaCen.id) });
    expect(sinSaldo.status).toBe(400);
    expect(sinSaldo.body.message).toBe('Saldo insuficiente en la caja');
    await t.ingresar({ efectivo: 2000 });
    expect((await t.http.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago: '2026-11-15', medios: medio(t.cajaCen.id) })).status).toBe(200);
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(790);
  });

  it('no se puede anular un ingreso cuyo efectivo ya salió de la caja', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ efectivo: 10000 });
    await t.http.post('/api/tesoreria/movimientos-caja', { fecha: '2026-11-12', cajaId: t.cajaCen.id, tipo: 'EGRESO', cuentaContableId: await t.cuenta('5.2.01'), concepto: 'Gasto', importe: 10000 });
    const r = await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, { motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Hay valores de este ingreso que ya se movieron');
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(0);
  });

  it('un cheque de un ingreso anulado se puede volver a ingresar', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cheques: [t.cheque(100, { numero: '555' })] });
    await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, { motivo: 'Importe mal cargado' });
    const otra = await t.ingresar({ cheques: [t.cheque(1000, { numero: '555' })] });
    expect(otra.cheques[0].numero).toBe('555');
  });

  it('cambiar el código de la sucursal no rompe la numeración de ingresos', async () => {
    const t = await prepararTesoreria(app, prisma);
    expect((await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 1 })).numero).toBe(1);
    expect((await t.http.patch(`/api/tesoreria/sucursales/${t.ros.id}`, { codigo: 'RO1' })).status).toBe(200);
    expect((await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 1 })).numero).toBe(2);
  });

  it('Valores a depositar se cancela exacto con cheques en dólares; la diferencia va a diferencia de cambio', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cajaId: t.cajaUsd.id, cheques: [t.cheque(10)] });
    await prisma.cotizacion.create({ data: { empresaId: t.empresaId, monedaCodigo: 'USD', fecha: new Date('2026-11-12T00:00:00Z'), valor: 1100 } });
    const dep = await t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaUsd.id, cuentaBancariaId: t.usd.id, cheques: [ing.cheques[0].id] });
    expect(dep.status).toBe(201);
    expect(await t.asiento(dep.body.asientoId)).toEqual({ '1.1.01.002': ['11000', '0'], '1.1.01.003': ['0', '10000'], '4.2.01': ['0', '1000'] });
  });
});
