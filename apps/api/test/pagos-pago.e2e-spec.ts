import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase, otroUsuario } from './helpers';
import { prepararPagos } from './helpers-pagos';

describe('pago de órdenes de pago', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const preparar = (o: { regimen?: string; iibb?: number } = {}) => prepararPagos(app, prisma, o);

  it('pago combinado con retenciones de Ganancias e IIBB, certificados y asiento', async () => {
    const p = await preparar({ regimen: '94', iibb: 2 });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 121000 }]);
    const r = await p.pagar(op, [
      { tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 100000, cuentaBancariaId: p.ars.id, referencia: 'TRF 1' },
      { tipo: 'CHEQUE', monedaCodigo: 'ARS', importe: 18343.4, chequeraId: p.echeq.id, chequeNumero: 'E-0001', chequeFechaPago: '2026-12-15' },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'PAGADA', totalRetenciones: '2656.6', netoPagar: '118343.4' });
    const rets = r.body.retenciones.filter((x: { importe: string }) => Number(x.importe) > 0);
    expect(rets.map((x: { impuesto: string; importe: string; certificadoNumero: number }) => [x.impuesto, x.importe, x.certificadoNumero]).sort())
      .toEqual([['GANANCIAS', '656.6', 1], ['IIBB', '2000', 1]]);
    expect((await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: f.movimientoId } })).saldo.toString()).toBe('0');
    expect(await p.asiento(r.body.asientoId)).toEqual({
      '2.1.01.001': ['121000', '0'], '2.1.02.002': ['0', '656.6'], '2.1.02.004': ['0', '2000'], '1.1.01.002': ['0', '100000'], '2.1.01.002': ['0', '18343.4'],
    });
    expect(await prisma.movimientoTesoreria.count()).toBe(1);
    expect(await prisma.chequePropio.count({ where: { estado: 'EMITIDO' } })).toBe(1);
  });

  it('recalcular retenciones con otra fecha de pago sin guardar', async () => {
    const p = await preparar({ regimen: '94', iibb: 2 });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 121000 }]);
    const r = await p.http.get(`/api/pagos/ordenes/${op.id}/retenciones?fechaPago=2026-11-15`);
    expect(r.status).toBe(200);
    expect(r.body.retenciones.filter((x: { importe: string }) => Number(x.importe) > 0).map((x: { importe: string }) => x.importe).sort()).toEqual(['2000.00', '656.60']);
    expect(r.body).toMatchObject({ totalRetenciones: '2656.60', netoPagar: '118343.40' });
    expect((await p.http.get(`/api/pagos/ordenes/${op.id}/retenciones?fechaPago=abc`)).status).toBe(400);
  });

  it('factura en USD pagada en efectivo USD con diferencia de cambio', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 121 }], { cotizacion: 1100 });
    const r = await p.pagar(op, [{ tipo: 'EFECTIVO', monedaCodigo: 'USD', importe: 121, cajaId: p.cajaUsd.id }]);
    expect(r.status).toBe(200);
    const m = await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: f.movimientoId } });
    expect([m.saldo.toString(), m.saldoPesos.toString()]).toEqual(['0', '0']);
    expect(await p.asiento(r.body.asientoId)).toEqual({ '2.1.01.001': ['121000', '0'], '5.2.03': ['12100', '0'], '1.1.01.001': ['0', '133100'] });
  });

  it('pago parcial en USD baja el saldo en pesos a la cotización original', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100, moneda: 'USD', cotizacion: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 40 }], { cotizacion: 1100 });
    expect((await p.pagar(op, [{ tipo: 'EFECTIVO', monedaCodigo: 'USD', importe: 40, cajaId: p.cajaUsd.id }])).status).toBe(200);
    const m = await prisma.movimientoCuentaCorriente.findUniqueOrThrow({ where: { id: f.movimientoId } });
    expect([m.saldo.toString(), m.saldoPesos.toString()]).toEqual(['81', '81000']);
  });

  it('medios + retenciones distinto del total → 400', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const r = await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1200, cuentaBancariaId: p.ars.id }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Los medios de pago ($1.200,00) más las retenciones ($0,00) no coinciden con el total a cancelar ($1.210,00)');
  });

  it('medio en moneda distinta a la de la cuenta → 400', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }], { cotizacion: 1000 });
    const r = await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'USD', importe: 1.21, cuentaBancariaId: p.ars.id }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La moneda del medio de pago no coincide con la de la cuenta');
  });

  it('cheques físicos: rango, número repetido y próximo número', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 3000 });
    const cheque = (numero?: string) => ({ tipo: 'CHEQUE', monedaCodigo: 'ARS', importe: 1210, chequeraId: p.fisica.id, chequeNumero: numero, chequeFechaPago: '2026-11-15' });
    const op1 = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const fuera = await p.pagar(op1, [cheque('60')]);
    expect(fuera.status).toBe(400);
    expect(fuera.body.message).toBe('El número de cheque está fuera del rango de la chequera');
    expect((await p.pagar(op1, [cheque()])).status).toBe(200);
    expect((await prisma.chequePropio.findFirstOrThrow()).numero).toBe('1');
    expect((await prisma.chequera.findUniqueOrThrow({ where: { id: p.fisica.id } })).proximoNumero).toBe(2);
    const op2 = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const rep = await p.pagar(op2, [cheque('1')]);
    expect(rep.status).toBe(409);
    expect(rep.body.message).toBe('El cheque 1 ya fue emitido');
  });

  it('dos pagos simultáneos de la misma OP: uno 200 y otro 409', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const medio = [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1210, cuentaBancariaId: p.ars.id }];
    const rs = await Promise.all([p.pagar(op, medio), p.pagar(op, medio)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('el acumulado de Ganancias usa el mes de la fecha de pago', async () => {
    const p = await preparar({ regimen: '94' });
    const f1 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 50000 });
    const f2 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 50000 });
    const op1 = await p.opAprobada([{ movimientoId: f1.movimientoId, importe: 60500 }]);
    const r1 = await p.pagar(op1, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 60500, cuentaBancariaId: p.ars.id }], '2026-11-02');
    expect(r1.body.totalRetenciones).toBe('0');
    const op2 = await p.opAprobada([{ movimientoId: f2.movimientoId, importe: 60500 }], { fecha: '2026-10-31' });
    const r2 = await p.pagar(op2, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 59843.4, cuentaBancariaId: p.ars.id }], '2026-11-03');
    expect(r2.status).toBe(200);
    expect(r2.body.totalRetenciones).toBe('656.6');
  });

  it('anticipo y su aplicación posterior', async () => {
    const p = await preparar();
    const op = await p.opAprobada([], { anticipo: { monedaCodigo: 'ARS', importe: 5000 } });
    const r = await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 5000, cuentaBancariaId: p.ars.id }]);
    expect(await p.asiento(r.body.asientoId)).toEqual({ '1.1.04.001': ['5000', '0'], '1.1.01.002': ['0', '5000'] });
    const ant = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'ANTICIPO' } });
    expect(ant.saldo.toString()).toBe('-5000');
    const chica = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const mal = await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-20', imputaciones: [{ movimientoId: chica.movimientoId, importe: 1210 }, { movimientoId: ant.id, importe: -1210 }] });
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('La orden de pago no tiene importe a pagar');
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 5000 });
    const op2 = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 6050 }, { movimientoId: ant.id, importe: -5000 }]);
    const r2 = await p.pagar(op2, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1050, cuentaBancariaId: p.ars.id }], '2026-11-20');
    expect(r2.status).toBe(200);
    expect(await p.asiento(r2.body.asientoId)).toEqual({ '2.1.01.001': ['6050', '0'], '1.1.04.001': ['0', '5000'], '1.1.01.002': ['0', '1050'] });
  });

  it('sin pago.ejecutar → 403; OP pendiente → 400', async () => {
    const p = await preparar();
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 1210 }]);
    const u = await otroUsuario(app, prisma, p.empresaId, ['op.ver']);
    expect((await p.pagar(op, [], '2026-11-15', u.http)).status).toBe(403);
    await prisma.empresa.update({ where: { id: p.empresaId }, data: { montoAprobacionOp: 0 } });
    const f2 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000 });
    const b = (await p.http.post('/api/pagos/ordenes', { terceroId: p.proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: f2.movimientoId, importe: 1210 }] })).body;
    const c = (await p.http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    expect(c.estado).toBe('PENDIENTE_APROBACION');
    const r = await p.pagar(c, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 1210, cuentaBancariaId: p.ars.id }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Solo se pueden pagar órdenes aprobadas');
  });
});
