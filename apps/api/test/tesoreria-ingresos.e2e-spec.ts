import { INestApplication } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

const haceDias = (d: number) => {
  const f = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() - d);
  return f.toISOString().slice(0, 10);
};

describe('recepción de valores', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('ingreso de cliente en ROS con efectivo, cheque y transferencia', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.rosario.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: t.cajaRos.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobranza',
      efectivo: { importe: 10000 }, cheques: [t.cheque(50000, { numero: '123' })],
      transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', referencia: 'TRF 1', importe: 20000 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.numero).toBe(1);
    expect(r.body.advertencias).toEqual([]);
    expect(await t.saldoCaja(t.cajaRos.id)).toBe(10000);
    const ch = await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: r.body.id }, include: { historial: true } });
    expect(ch).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaRos.id, terceroOrigenId: t.clienteId, monedaCodigo: 'ARS' });
    expect(ch.historial).toHaveLength(1);
    expect(ch.historial[0]).toMatchObject({ estadoAnterior: null, estadoNuevo: 'EN_CARTERA', cajaId: t.cajaRos.id, origenTipo: 'INGRESO' });
    const tr = await prisma.transferenciaRecibida.findFirstOrThrow({ where: { ingresoId: r.body.id } });
    expect(tr.estado).toBe('PENDIENTE');
    expect(await t.saldoBanco(t.ars.id)).toBe(0);
    const cc = await prisma.movimientoCuentaCorriente.findMany({ where: { terceroId: t.clienteId } });
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({ origenTipo: 'COBRO', origenId: r.body.id, monedaCodigo: 'ARS' });
    expect(cc[0].importe.toString()).toBe('-80000');
    expect(cc[0].saldo.toString()).toBe('-80000');
    expect(await t.asiento(r.body.asientoId)).toEqual({
      '1.1.01.001': ['10000', '0'], '1.1.01.003': ['50000', '0'], '1.1.01.004': ['20000', '0'], '1.1.02.001': ['0', '80000'],
    });
    // Numeración propia por sucursal
    const otro = await t.ingresar({ efectivo: 1 });
    expect(otro.numero).toBe(1);
    expect((await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 1 })).numero).toBe(2);
  });

  it('ingreso en dólares: asiento en pesos a la cotización del día y movimiento de cuenta corriente por moneda', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: t.cajaUsd.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'Cobranza USD',
      efectivo: { importe: 100 }, cheques: [], transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', importe: 5000 }],
    });
    expect(r.status).toBe(201);
    const cc = await prisma.movimientoCuentaCorriente.findMany({ where: { terceroId: t.clienteId }, orderBy: { monedaCodigo: 'asc' } });
    expect(cc.map((m) => [m.monedaCodigo, m.importe.toString(), m.importePesos.toString()])).toEqual([['ARS', '-5000', '-5000'], ['USD', '-100', '-100000']]);
    expect(await t.asiento(r.body.asientoId)).toEqual({ '1.1.01.001': ['100000', '0'], '1.1.01.004': ['5000', '0'], '1.1.02.001': ['0', '105000'] });
  });

  it('origen OTRO exige una cuenta imputable; sin valores → 400', async () => {
    const t = await prepararTesoreria(app, prisma);
    const base = { fecha: '2026-11-10', cajaId: t.cajaCen.id, origen: 'OTRO', concepto: 'Aporte', efectivo: { importe: 100 }, cheques: [], transferencias: [] };
    expect((await t.http.post('/api/tesoreria/ingresos', { ...base, cuentaContableId: await t.cuenta('1.1.01') })).status).toBe(400);
    expect((await t.http.post('/api/tesoreria/ingresos', base)).status).toBe(400);
    const ok = await t.http.post('/api/tesoreria/ingresos', { ...base, cuentaContableId: await t.cuenta('4.2.01') });
    expect(ok.status).toBe(201);
    expect(await t.asiento(ok.body.asientoId)).toEqual({ '1.1.01.001': ['100', '0'], '4.2.01': ['0', '100'] });
    const vacio = await t.http.post('/api/tesoreria/ingresos', { ...base, efectivo: undefined, cuentaContableId: await t.cuenta('4.2.01') });
    expect(vacio.status).toBe(400);
    expect(vacio.body.message).toBe('Ingrese al menos un valor');
    const proveedor = await t.http.post('/api/tesoreria/ingresos', { ...base, origen: 'CLIENTE', terceroId: t.proveedorId });
    expect(proveedor.status).toBe(400);
  });

  it('cheque duplicado → 409', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.ingresar({ cheques: [t.cheque(100, { numero: '123' })] });
    const r = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'x', cheques: [t.cheque(200, { numero: '123' })], transferencias: [],
    });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('El cheque 123 del banco Galicia ya fue registrado');
  });

  it('cheque vencido hace 40 días → 201 con advertencia', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.http.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'x',
      cheques: [t.cheque(100, { numero: '123', fechaEmision: haceDias(45), fechaPago: haceDias(40) })], transferencias: [],
    });
    expect(r.status).toBe(201);
    expect(r.body.advertencias).toEqual(['El cheque 123 está vencido para depositar']);
  });

  it('el usuario de ROS no puede ingresar en la caja de CEN ni ver sus ingresos (404)', async () => {
    const t = await prepararTesoreria(app, prisma);
    const r = await t.rosario.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: t.cajaCen.id, origen: 'CLIENTE', terceroId: t.clienteId, concepto: 'x', efectivo: { importe: 1 }, cheques: [], transferencias: [],
    });
    expect(r.status).toBe(404);
    const cen = await t.ingresar({ efectivo: 5 });
    const ros = await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 7 });
    expect((await t.rosario.get(`/api/tesoreria/ingresos/${cen.id}`)).status).toBe(404);
    expect((await t.rosario.get(`/api/tesoreria/ingresos/${ros.id}`)).status).toBe(200);
    const lista = (await t.rosario.get('/api/tesoreria/ingresos')).body;
    expect(lista.items.map((i: { id: string }) => i.id)).toEqual([ros.id]);
    expect((await t.http.get('/api/tesoreria/ingresos')).body.total).toBe(2);
  });

  it('anular el ingreso revierte todo', async () => {
    const t = await prepararTesoreria(app, prisma, ['tesoreria.ver', 'tesoreria.operar']);
    const ing = await t.ingresar({ efectivo: 10000, cheques: [t.cheque(50000)], transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', importe: 20000 }] });
    expect((await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, {})).status).toBe(400);
    const r = await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, { motivo: 'Error de carga' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ANULADO');
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(0);
    const ch = await prisma.chequeTercero.findFirstOrThrow({ where: { ingresoId: ing.id }, include: { historial: true } });
    expect(ch.estado).toBe('ANULADO');
    expect(ch.historial).toHaveLength(2);
    expect((await prisma.transferenciaRecibida.findFirstOrThrow({ where: { ingresoId: ing.id } })).estado).toBe('ANULADA');
    expect((await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId: ing.id } })).anulado).toBe(true);
    expect(await t.asiento(r.body.asientoAnulacionId)).toEqual({
      '1.1.01.001': ['0', '10000'], '1.1.01.003': ['0', '50000'], '1.1.01.004': ['0', '20000'], '1.1.02.001': ['80000', '0'],
    });
    expect((await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, { motivo: 'otra vez' })).status).toBe(400);
    // Sin permiso de anular
    const ros = await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 1 });
    expect((await t.rosario.post(`/api/tesoreria/ingresos/${ros.id}/anular`, { motivo: 'x' })).status).toBe(403);
  });
});
