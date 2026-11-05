import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('endoso de cheques de terceros en órdenes de pago', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Factura de 60.500 al proveedor, OP aprobada por el total y un cheque de 50.000 en cartera. */
  async function preparar(cotizacion?: number) {
    const t = await prepararTesoreria(app, prisma);
    const fc = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 50000 });
    const b = await t.http.post('/api/pagos/ordenes', { terceroId: t.proveedorId, fecha: '2026-11-10', cotizacion, imputaciones: [{ movimientoId: fc.movimientoId, importe: 60500 }] });
    if (b.status !== 201) throw new Error(JSON.stringify(b.body));
    const op = (await t.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version })).body;
    if (op.estado !== 'APROBADA') throw new Error(JSON.stringify(op));
    const ing = await t.ingresar({ cheques: [t.cheque(50000)] });
    const pagar = (medios: object[]) => t.http.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago: '2026-11-15', medios });
    return { t, op, chequeId: ing.cheques[0].id, pagar };
  }
  const transferencia = (t: Awaited<ReturnType<typeof prepararTesoreria>>, importe: number) => ({ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe, cuentaBancariaId: t.ars.id });

  it('pago con un cheque de terceros más una transferencia; anular la OP lo devuelve a cartera', async () => {
    const { t, op, chequeId, pagar } = await preparar();
    const r = await pagar([{ tipo: 'CHEQUE_TERCERO', chequeId }, transferencia(t, 10500)]);
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('PAGADA');
    const ch = await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } });
    expect(ch).toMatchObject({ estado: 'ENDOSADO', terceroDestinoId: t.proveedorId, cajaId: null });
    const pagada = await prisma.ordenPago.findUniqueOrThrow({ where: { id: op.id } });
    expect(await t.asiento(pagada.asientoId!)).toEqual({ '2.1.01.001': ['60500', '0'], '1.1.01.003': ['0', '50000'], '1.1.01.002': ['0', '10500'] });
    expect(await prisma.movimientoTesoreria.count({ where: { origenTipo: 'OP', origenId: op.id } })).toBe(1);
    const medio = await prisma.ordenPagoMedio.findFirstOrThrow({ where: { ordenPagoId: op.id, tipo: 'CHEQUE_TERCERO' } });
    expect(medio).toMatchObject({ chequeTerceroId: chequeId, cajaId: t.cajaCen.id, monedaCodigo: 'ARS' });
    expect(medio.importe.toString()).toBe('50000');

    const a = await t.http.post(`/api/pagos/ordenes/${op.id}/anular`, { version: pagada.version, motivo: 'Error' });
    expect(a.status).toBe(200);
    expect(await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaCen.id, terceroDestinoId: null });
  });

  it('un cheque que no está en cartera no se puede endosar', async () => {
    const { t, chequeId, pagar } = await preparar();
    await t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [chequeId] });
    const numero = (await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).numero;
    const r = await pagar([{ tipo: 'CHEQUE_TERCERO', chequeId }, transferencia(t, 10500)]);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(`El cheque ${numero} ya no está disponible`);
    expect((await pagar([{ tipo: 'CHEQUE_TERCERO' }, transferencia(t, 10500)])).status).toBe(400);
  });

  it('cheque en dólares: exige cotización en la OP y se valúa con ella', async () => {
    const sin = await preparar();
    const usd = await sin.t.ingresar({ cajaId: sin.t.cajaUsd.id, cheques: [sin.t.cheque(10)] });
    const r = await sin.pagar([{ tipo: 'CHEQUE_TERCERO', chequeId: usd.cheques[0].id }, transferencia(sin.t, 49500)]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Para pagar en dólares, indique la cotización del dólar en la orden de pago');

    const con = await preparar(1100);
    const usd2 = await con.t.ingresar({ cajaId: con.t.cajaUsd.id, cheques: [con.t.cheque(10)] });
    const ok = await con.pagar([{ tipo: 'CHEQUE_TERCERO', chequeId: usd2.cheques[0].id }, transferencia(con.t, 49500)]);
    expect(ok.status).toBe(200);
    const medio = await prisma.ordenPagoMedio.findFirstOrThrow({ where: { ordenPagoId: con.op.id, tipo: 'CHEQUE_TERCERO' } });
    expect(medio.monedaCodigo).toBe('USD');
    expect(medio.importePesos.toString()).toBe('11000');
  });

  it('el usuario solo puede endosar cheques de cajas de su sucursal', async () => {
    const { t, op } = await preparar();
    const pagador = await t.usuario(['op.ver', 'pago.ejecutar'], t.ros.id);
    const ing = await t.ingresar({ cheques: [t.cheque(50000)] });
    const r = await pagador.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago: '2026-11-15', medios: [{ tipo: 'CHEQUE_TERCERO', chequeId: ing.cheques[0].id }, transferencia(t, 10500)] });
    expect(r.status).toBe(404);
  });

  it('rechazo de un cheque endosado: vuelve la deuda con el proveedor y el cliente', async () => {
    const { t, chequeId, pagar } = await preparar();
    await pagar([{ tipo: 'CHEQUE_TERCERO', chequeId }, transferencia(t, 10500)]);
    const r = await t.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-20', motivo: 'Informado por el proveedor' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('RECHAZADO');
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'RECHAZO_CHEQUE', origenId: chequeId } });
    expect(await t.asiento(asiento.id)).toEqual({ '1.1.02.002': ['50000', '0'], '2.1.01.001': ['0', '50000'] });
    const movs = await prisma.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'CHEQUE_RECHAZADO', origenId: chequeId } });
    expect(movs.map((m) => [m.terceroId, m.importe.toString()]).sort()).toEqual([[t.clienteId, '50000'], [t.proveedorId, '50000']].sort());
    expect((await t.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-20', motivo: 'x', gastos: 0 })).status).toBe(400);
  });
});
