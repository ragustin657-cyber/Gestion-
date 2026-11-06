import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

const enDias = (d: number) => {
  const f = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() + d);
  return f.toISOString().slice(0, 10);
};

describe('consultas de tesorería', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Circuito completo: ingreso en ROS → traslado a CEN → depósito → acreditación. */
  async function circuito() {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 10000, cheques: [t.cheque(50000)], transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', importe: 20000 }] }, t.rosario);
    const chequeId = ing.cheques[0].id;
    const tr = (await t.rosario.post('/api/tesoreria/traslados', { fecha: '2026-11-11', cajaOrigenId: t.cajaRos.id, cajaDestinoId: t.cajaCen.id, cheques: [chequeId], efectivo: { importe: 4000 } })).body;
    await t.http.post(`/api/tesoreria/traslados/${tr.id}/recibir`, { fecha: '2026-11-11', items: tr.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })) });
    await t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [chequeId], efectivo: { importe: 3000 } });
    await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [chequeId], transferencias: [ing.transferencias[0].id] });
    return { t, chequeId };
  }

  it('saldos de bancos y cajas después del circuito; el usuario de sucursal no ve bancos', async () => {
    const { t } = await circuito();
    await t.ingresar({ cheques: [t.cheque(700)] });
    const s = (await t.http.get('/api/tesoreria/saldos?fecha=2026-11-30')).body;
    expect(s.bancos.find((b: { id: string }) => b.id === t.ars.id)).toMatchObject({ monedaCodigo: 'ARS', saldo: '73000', nombre: 'Banco Nación - 1' });
    expect(s.cajas.find((c: { id: string }) => c.id === t.cajaCen.id)).toMatchObject({ efectivo: '1000', cheques: '700', sucursal: 'Casa central' });
    expect(s.cajas.find((c: { id: string }) => c.id === t.cajaRos.id)).toMatchObject({ efectivo: '6000', cheques: '0' });
    const alDia = (await t.http.get('/api/tesoreria/saldos?fecha=2026-11-12')).body;
    expect(alDia.bancos.find((b: { id: string }) => b.id === t.ars.id).saldo).toBe('53000');
    const ros = (await t.rosario.get('/api/tesoreria/saldos?fecha=2026-11-30')).body;
    expect(ros.bancos).toEqual([]);
    expect(ros.cajas.map((c: { id: string }) => c.id)).toEqual([t.cajaRos.id]);
    expect((await t.http.get('/api/tesoreria/saldos?fecha=2026-02-30')).status).toBe(400);
  });

  it('movimientos de una cuenta bancaria entre fechas con saldo inicial y acumulado', async () => {
    const { t } = await circuito();
    const r = (await t.http.get(`/api/tesoreria/movimientos?cuentaBancariaId=${t.ars.id}&desde=2026-11-13&hasta=2026-11-30`)).body;
    expect(r.saldoInicial).toBe('53000');
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0]).toMatchObject({ tipo: 'INGRESO', origenTipo: 'ACREDITACION_TRANSFERENCIA', importe: '20000', saldo: '73000', descripcion: 'Acreditación de transferencia' });
    expect(r.saldoFinal).toBe('73000');
    const caja = (await t.rosario.get(`/api/tesoreria/movimientos?cajaId=${t.cajaRos.id}`)).body;
    expect(caja.movimientos.map((m: { importe: string; tipo: string }) => [m.tipo, m.importe])).toEqual([['INGRESO', '10000'], ['EGRESO', '4000']]);
    expect(caja.saldoFinal).toBe('6000');
    expect((await t.rosario.get(`/api/tesoreria/movimientos?cajaId=${t.cajaCen.id}`)).status).toBe(404);
    expect((await t.rosario.get(`/api/tesoreria/movimientos?cuentaBancariaId=${t.ars.id}`)).status).toBe(404);
    expect((await t.http.get('/api/tesoreria/movimientos')).status).toBe(400);
    expect((await t.http.get(`/api/tesoreria/movimientos?cajaId=${t.cajaRos.id}&desde=xx`)).status).toBe(400);
  });

  it('flujo de fondos proyectado', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.http.post('/api/tesoreria/movimientos-bancarios', { fecha: enDias(-1), cuentaBancariaId: t.ars.id, tipo: 'INGRESO', cuentaContableId: await t.cuenta('4.2.01'), concepto: 'Saldo', importe: 100000 });
    await t.ingresar({ cheques: [t.cheque(30000, { fechaPago: enDias(10) })] });
    const chequera = (await t.http.post('/api/tesoreria/chequeras', { cuentaBancariaId: t.ars.id, tipo: 'ECHEQ' })).body;
    await prisma.chequePropio.create({
      data: { empresaId: t.empresaId, chequeraId: chequera.id, numero: 'E-9', fechaEmision: new Date(`${enDias(-5)}T00:00:00Z`), fechaPago: new Date(`${enDias(5)}T00:00:00Z`), monedaCodigo: 'ARS', importe: 12000, beneficiarioId: t.proveedorId, ordenPagoId: randomUUID() },
    });
    const r = await t.http.get('/api/tesoreria/flujo?dias=30');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(30);
    expect(r.body[0]).toMatchObject({ fecha: enDias(0), ingresos: '0', egresos: '0', saldo: '100000' });
    expect(r.body[5]).toMatchObject({ fecha: enDias(5), egresos: '12000', saldo: '88000' });
    expect(r.body[10]).toMatchObject({ fecha: enDias(10), ingresos: '30000', saldo: '118000' });
    expect(r.body[29].saldo).toBe('118000');
    expect((await t.http.get('/api/tesoreria/flujo?dias=0')).status).toBe(400);
    expect((await t.http.get('/api/tesoreria/flujo?dias=abc')).status).toBe(400);
  });
});
