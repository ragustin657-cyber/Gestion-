import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

const f = (s: string) => new Date(`${s}T00:00:00Z`);
type Fila = { etiqueta: string; saldo: string; ingresos: Record<string, string>; egresos: Record<string, string> };

describe('finanzas: flujo de fondos proyectado', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Escenario del spec §4. */
  const escenario = async () => {
    const t = await prepararTesoreria(app, prisma);
    await prisma.empresa.update({ where: { id: t.empresaId }, data: { montoAprobacionOp: 1e12 } });
    const mov = (data: { cuentaBancariaId?: string; cajaId?: string; importe: number }) => prisma.movimientoTesoreria.create({ data: { empresaId: t.empresaId, fecha: f('2026-11-01'), tipo: 'INGRESO', monedaCodigo: 'ARS', origenTipo: 'SALDO_INICIAL', origenId: randomUUID(), ...data } });
    await mov({ cuentaBancariaId: t.ars.id, importe: 100000 });
    await mov({ cajaId: t.cajaCen.id, importe: 5000 });
    await t.ingresar({ cheques: [t.cheque(30000, { fechaPago: '2026-11-16' })] });
    const cliente = (importe: number, vence: string) => prisma.movimientoCuentaCorriente.create({
      data: { empresaId: t.empresaId, terceroId: t.clienteId, origenTipo: 'VENTA', origenId: randomUUID(), fecha: f('2026-10-01'), fechaVencimiento: f(vence), monedaCodigo: 'ARS', importe, importePesos: importe, saldo: importe, saldoPesos: importe },
    });
    await cliente(60500, '2026-11-20');
    await cliente(12100, '2026-10-15');
    const vence = (movimientoId: string, fecha: string) => prisma.movimientoCuentaCorriente.update({ where: { id: movimientoId }, data: { fechaVencimiento: f(fecha) } });
    const fp = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 20000 });
    await vence(fp.movimientoId, '2026-11-25');
    const fop = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 40000 });
    await vence(fop.movimientoId, '2026-11-20');
    const op = async (movimientoId: string, importe: number) => {
      const b = await t.http.post('/api/pagos/ordenes', { terceroId: t.proveedorId, fecha: '2026-11-06', imputaciones: [{ movimientoId, importe }] });
      if (b.status !== 201) throw new Error(JSON.stringify(b.body));
      const c = await t.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
      if (c.body.estado !== 'APROBADA') throw new Error(JSON.stringify(c.body));
      return c.body;
    };
    await op(fop.movimientoId, 48400);
    const chequera = (await t.http.post('/api/tesoreria/chequeras', { cuentaBancariaId: t.ars.id, tipo: 'ECHEQ' })).body;
    await prisma.chequePropio.create({
      data: { empresaId: t.empresaId, chequeraId: chequera.id, numero: 'E-9', fechaEmision: f('2026-11-01'), fechaPago: f('2026-11-11'), monedaCodigo: 'ARS', importe: 12000, beneficiarioId: t.proveedorId, ordenPagoId: randomUUID() },
    });
    return { ...t, op, vence };
  };
  const flujo = (http: { get: (u: string) => Promise<{ status: number; body: any }> }, q: string) => http.get(`/api/tesoreria/flujo?${q}`); // eslint-disable-line @typescript-eslint/no-explicit-any

  it('ejemplo del spec por semana', async () => {
    const t = await escenario();
    const r = (await flujo(t.http, 'hasta=2026-11-29&agrupar=semana')).body;
    expect(r.saldoInicial).toBe('105000.00');
    expect(r.filas.map((x: Fila) => [x.etiqueta, x.saldo])).toEqual([['06/11–08/11', '68700.00'], ['09/11–15/11', '56700.00'], ['16/11–22/11', '147200.00'], ['23/11–29/11', '123000.00']]);
    expect(r.filas[0]).toMatchObject({ ingresos: { vencidoACobrar: '12100.00' }, egresos: { ordenesPago: '48400.00', proveedores: '0.00' } });
    expect(r.filas[1].egresos.chequesPropios).toBe('12000.00');
    expect(r.filas[2].ingresos).toMatchObject({ cheques: '30000.00', cobranzas: '60500.00' });
    expect(r.filas[3].egresos.proveedores).toBe('24200.00');
    expect(r.primerNegativo).toBeNull();
  });

  it('sin vencidos', async () => {
    const t = await escenario();
    const r = (await flujo(t.http, 'hasta=2026-11-29&agrupar=semana&incluirVencidos=false')).body;
    expect(r.filas.map((x: Fila) => x.saldo)).toEqual(['56600.00', '44600.00', '135100.00', '110900.00']);
    expect(r.filas[0].ingresos.vencidoACobrar).toBe('12100.00');
  });

  it('OP parcial no duplica', async () => {
    const t = await prepararTesoreria(app, prisma);
    await prisma.empresa.update({ where: { id: t.empresaId }, data: { montoAprobacionOp: 1e12 } });
    const fp = await facturaPendiente(t.http, prisma, { proveedorId: t.proveedorId, neto: 10000 });
    await prisma.movimientoCuentaCorriente.update({ where: { id: fp.movimientoId }, data: { fechaVencimiento: f('2026-11-20') } });
    const b = await t.http.post('/api/pagos/ordenes', { terceroId: t.proveedorId, fecha: '2026-11-06', imputaciones: [{ movimientoId: fp.movimientoId, importe: 4000 }] });
    await t.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
    const r = (await flujo(t.http, 'hasta=2026-11-22&agrupar=semana')).body;
    expect(r.filas[0].egresos.ordenesPago).toBe('4000.00');
    expect(r.filas[2].egresos.proveedores).toBe('8100.00');
  });

  it('dólares a la cotización del día', async () => {
    const t = await prepararTesoreria(app, prisma);
    await prisma.movimientoTesoreria.create({ data: { empresaId: t.empresaId, fecha: f('2026-11-01'), tipo: 'INGRESO', monedaCodigo: 'USD', cuentaBancariaId: t.usd.id, importe: 100, origenTipo: 'SALDO_INICIAL', origenId: randomUUID() } });
    expect((await flujo(t.http, 'hasta=2026-11-08')).body.saldoInicial).toBe('100000.00');
    await prisma.cotizacion.deleteMany({ where: { empresaId: t.empresaId } });
    const r = await flujo(t.http, 'hasta=2026-11-08');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Falta la cotización del dólar');
  });

  it('saldo negativo', async () => {
    const t = await escenario();
    await prisma.movimientoTesoreria.updateMany({ where: { empresaId: t.empresaId, origenTipo: 'SALDO_INICIAL', cuentaBancariaId: { not: null } }, data: { importe: 10000 } });
    expect((await flujo(t.http, 'hasta=2026-11-29')).body.primerNegativo).toBe('06/11–08/11');
  });

  it('empresa vacía', async () => {
    const s = await sesionConPlan(app, prisma);
    const r = (await flujo(s.http, 'hasta=2026-11-29&agrupar=semana')).body;
    expect(r.saldoInicial).toBe('0.00');
    expect(r.filas.map((x: Fila) => x.saldo)).toEqual(['0.00', '0.00', '0.00', '0.00']);
    expect(r.primerNegativo).toBeNull();
  });

  it('por día y por mes; límites', async () => {
    const s = await sesionConPlan(app, prisma);
    expect((await flujo(s.http, 'agrupar=dia&hasta=2027-02-03')).body.filas).toHaveLength(90);
    const largo = await flujo(s.http, 'agrupar=dia&hasta=2027-02-04');
    expect([largo.status, largo.body.message]).toEqual([400, 'El flujo diario admite hasta 90 días']);
    expect((await flujo(s.http, 'agrupar=mes&hasta=2027-01-15')).body.filas.map((x: Fila) => x.etiqueta)).toEqual(['nov 2026', 'dic 2026', 'ene 2027']);
    expect((await flujo(s.http, 'hasta=2026-11-05')).status).toBe(400);
    const def = (await flujo(s.http, '')).body;
    expect([def.agrupar, def.hasta, def.incluirVencidos]).toEqual(['semana', '2027-01-01', true]);
  });

  it('detalle de un período', async () => {
    const t = await escenario();
    const r = (await t.http.get('/api/tesoreria/flujo/detalle?desde=2026-11-16&hasta=2026-11-22')).body;
    expect(r.map((x: { concepto: string; importe: string }) => [x.concepto, x.importe])).toEqual([['cheques', '30000.00'], ['cobranzas', '60500.00']]);
    const hoy = (await t.http.get('/api/tesoreria/flujo/detalle?desde=2026-11-06&hasta=2026-11-08')).body;
    expect(hoy.map((x: { concepto: string }) => x.concepto).sort()).toEqual(['ordenesPago', 'vencidoACobrar']);
  });

  it('usuario de sucursal', async () => {
    const t = await escenario();
    await t.ingresar({ cajaId: t.cajaRos.id, cheques: [t.cheque(7000, { fechaPago: '2026-11-18' })] }, t.rosario);
    const r = (await flujo(t.rosario, 'hasta=2026-11-29')).body;
    expect(r.saldoInicial).toBe('0.00');
    expect(r.filas.map((x: Fila) => x.saldo)).toEqual(['0.00', '0.00', '7000.00', '7000.00']);
  });

  it('exporta', async () => {
    const t = await escenario();
    const bin = (url: string) => t.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((await bin('/api/tesoreria/flujo?hasta=2026-11-29&formato=xlsx')).headers['content-type']).toContain('spreadsheetml');
    expect((await bin('/api/tesoreria/flujo?hasta=2026-11-29&formato=pdf')).headers['content-type']).toContain('pdf');
  });
});
