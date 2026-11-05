import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('depósitos y acreditaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Ingreso en CEN con efectivo 10.000, cheque 50.000 y transferencia 20.000. */
  async function conValores() {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ efectivo: 10000, cheques: [t.cheque(50000)], transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', importe: 20000 }] });
    return { t, ing, chequeId: ing.cheques[0].id, transferenciaId: ing.transferencias[0].id };
  }

  const depositar = (t: Awaited<ReturnType<typeof prepararTesoreria>>, chequeId: string, extra: object = {}) =>
    t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, boleta: 'B-1', cheques: [chequeId], efectivo: { importe: 3000 }, ...extra });

  it('depósito de cheque y efectivo: estados, movimientos y asiento', async () => {
    const { t, chequeId } = await conValores();
    const r = await depositar(t, chequeId);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ numero: 1, estado: 'CONFIRMADO', boleta: 'B-1' });
    const ch = await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } });
    expect(ch).toMatchObject({ estado: 'DEPOSITADO', cuentaBancariaId: t.ars.id, cajaId: null });
    expect(ch.fechaDeposito!.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(7000);
    expect(await t.saldoBanco(t.ars.id)).toBe(53000);
    expect(await t.asiento(r.body.asientoId)).toEqual({ '1.1.01.002': ['53000', '0'], '1.1.01.003': ['0', '50000'], '1.1.01.001': ['0', '3000'] });
    const pend = (await t.http.get('/api/tesoreria/pendientes-acreditar')).body;
    expect(pend.cheques.map((c: { id: string }) => c.id)).toEqual([chequeId]);
    expect(pend.transferencias).toHaveLength(1);
  });

  it('moneda distinta, caja de otra sucursal y efectivo mayor al saldo', async () => {
    const { t, chequeId } = await conValores();
    const usd = await depositar(t, chequeId, { cuentaBancariaId: t.usd.id, efectivo: undefined });
    expect(usd.status).toBe(400);
    expect(usd.body.message).toBe('La moneda del valor no coincide con la de la cuenta o caja de destino');
    const ros = await t.rosario.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [chequeId] });
    expect(ros.status).toBe(404);
    const saldo = await depositar(t, chequeId, { efectivo: { importe: 10000.5 } });
    expect(saldo.status).toBe(400);
    expect(saldo.body.message).toBe('Saldo insuficiente en la caja');
  });

  it('acreditar cheque (sin asiento) y transferencia (con asiento); acreditar dos veces → 409', async () => {
    const { t, chequeId, transferenciaId } = await conValores();
    await depositar(t, chequeId);
    const asientosAntes = await prisma.asiento.count();
    const r = await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [chequeId], transferencias: [transferenciaId] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cheques: 1, transferencias: 1 });
    const ch = await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } });
    expect(ch.estado).toBe('ACREDITADO');
    expect(ch.fechaAcreditacion!.toISOString().slice(0, 10)).toBe('2026-11-14');
    const tr = await prisma.transferenciaRecibida.findUniqueOrThrow({ where: { id: transferenciaId } });
    expect(tr.estado).toBe('ACREDITADA');
    expect(await prisma.asiento.count()).toBe(asientosAntes + 1);
    expect(await t.asiento(tr.asientoAcreditacionId!)).toEqual({ '1.1.01.002': ['20000', '0'], '1.1.01.004': ['0', '20000'] });
    expect(await t.saldoBanco(t.ars.id)).toBe(73000);
    expect((await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [chequeId], transferencias: [] })).status).toBe(409);
    expect((await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [], transferencias: [transferenciaId] })).status).toBe(409);
    expect((await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [], transferencias: [] })).status).toBe(400);
    // Sin permiso
    expect((await t.rosario.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [chequeId], transferencias: [] })).status).toBe(403);
  });

  it('anular un depósito antes de acreditar; después no se puede', async () => {
    const { t, chequeId } = await conValores();
    const dep = (await depositar(t, chequeId)).body;
    const a = await t.http.post(`/api/tesoreria/depositos/${dep.id}/anular`, { motivo: 'Boleta mal cargada' });
    expect(a.status).toBe(200);
    expect(a.body.estado).toBe('ANULADO');
    expect(await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaCen.id, cuentaBancariaId: null });
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(10000);
    expect(await t.saldoBanco(t.ars.id)).toBe(0);
    expect(await t.asiento(a.body.asientoAnulacionId)).toEqual({ '1.1.01.002': ['0', '53000'], '1.1.01.003': ['50000', '0'], '1.1.01.001': ['3000', '0'] });

    const dep2 = (await depositar(t, chequeId)).body;
    await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-14', cheques: [chequeId], transferencias: [] });
    const b = await t.http.post(`/api/tesoreria/depositos/${dep2.id}/anular`, { motivo: 'x' });
    expect(b.status).toBe(400);
    expect(b.body.message).toBe('El depósito tiene cheques acreditados o rechazados');
    expect((await t.http.get('/api/tesoreria/depositos')).body.total).toBe(2);
    expect((await t.http.get(`/api/tesoreria/depositos/${dep2.id}`)).body.items).toHaveLength(2);
  });

  it('dos depósitos simultáneos del mismo cheque: uno entra y el otro 409', async () => {
    const { t, chequeId } = await conValores();
    const body = { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [chequeId] };
    const res = await Promise.all([t.http.post('/api/tesoreria/depositos', body), t.http.post('/api/tesoreria/depositos', body)]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
  });
});
