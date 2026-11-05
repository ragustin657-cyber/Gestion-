import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('rechazo y devolución de cheques de terceros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function depositado() {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ efectivo: 10000, cheques: [t.cheque(50000)], transferencias: [{ cuentaBancariaId: t.ars.id, fecha: '2026-11-10', importe: 20000 }] });
    const chequeId = ing.cheques[0].id;
    const dep = await t.http.post('/api/tesoreria/depositos', { fecha: '2026-11-12', cajaId: t.cajaCen.id, cuentaBancariaId: t.ars.id, cheques: [chequeId] });
    if (dep.status !== 201) throw new Error(JSON.stringify(dep.body));
    return { t, chequeId };
  }
  const saldoTercero = async (terceroId: string) =>
    (await prisma.movimientoCuentaCorriente.findMany({ where: { terceroId, anulado: false } })).reduce((s, m) => s + Number(m.saldo), 0);

  it('rechazo de un cheque depositado con gastos: banco, asiento y cuenta corriente del cliente', async () => {
    const { t, chequeId } = await depositado();
    const r = await t.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-15', motivo: 'Sin fondos', gastos: 500 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Sin fondos' });
    expect(r.body.fechaRechazo.slice(0, 10)).toBe('2026-11-15');
    expect(await t.saldoBanco(t.ars.id)).toBe(50000 - 50500);
    const egreso = await prisma.movimientoTesoreria.findFirstOrThrow({ where: { origenTipo: 'RECHAZO_CHEQUE', origenId: chequeId } });
    expect(egreso).toMatchObject({ tipo: 'EGRESO', cuentaBancariaId: t.ars.id });
    expect(egreso.importe.toString()).toBe('50500');
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'RECHAZO_CHEQUE', origenId: chequeId } });
    expect(await t.asiento(asiento.id)).toEqual({ '1.1.02.002': ['50000', '0'], '5.2.02': ['500', '0'], '1.1.01.002': ['0', '50500'] });
    const cc = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'CHEQUE_RECHAZADO', origenId: chequeId } });
    expect(cc).toMatchObject({ terceroId: t.clienteId });
    expect(cc.importe.toString()).toBe('50000');
    expect(await saldoTercero(t.clienteId)).toBe(-30000);
  });

  it('rechazo de un cheque acreditado sin gastos', async () => {
    const { t, chequeId } = await depositado();
    await t.http.post('/api/tesoreria/acreditaciones', { fecha: '2026-11-13', cheques: [chequeId], transferencias: [] });
    const r = await t.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-15', motivo: 'Firma no coincide' });
    expect(r.status).toBe(200);
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'RECHAZO_CHEQUE', origenId: chequeId } });
    expect(await t.asiento(asiento.id)).toEqual({ '1.1.02.002': ['50000', '0'], '1.1.01.002': ['0', '50000'] });
  });

  it('un cheque que no salió de la cartera no se puede rechazar', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cheques: [t.cheque(100)] });
    const r = await t.http.post(`/api/tesoreria/cheques/${ing.cheques[0].id}/rechazar`, { fecha: '2026-11-15', motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Solo se pueden rechazar cheques depositados, acreditados o endosados');
    expect((await t.http.post(`/api/tesoreria/cheques/${ing.cheques[0].id}/rechazar`, { fecha: '2026-11-15' })).status).toBe(400);
    expect((await t.rosario.post(`/api/tesoreria/cheques/${ing.cheques[0].id}/rechazar`, { fecha: '2026-11-15', motivo: 'x' })).status).toBe(403);
  });

  it('devolver un cheque rechazado; un depositado no se devuelve', async () => {
    const { t, chequeId } = await depositado();
    expect((await t.http.post(`/api/tesoreria/cheques/${chequeId}/devolver`, { fecha: '2026-11-16' })).status).toBe(409);
    await t.http.post(`/api/tesoreria/cheques/${chequeId}/rechazar`, { fecha: '2026-11-15', motivo: 'Sin fondos' });
    const asientos = await prisma.asiento.count();
    const d = await t.http.post(`/api/tesoreria/cheques/${chequeId}/devolver`, { fecha: '2026-11-16', observaciones: 'Entregado al cliente' });
    expect(d.status).toBe(200);
    expect(d.body.estado).toBe('DEVUELTO');
    expect(await prisma.asiento.count()).toBe(asientos);
    const hist = (await t.http.get(`/api/tesoreria/cheques/${chequeId}`)).body.historial;
    expect(hist.map((h: { estadoNuevo: string }) => h.estadoNuevo)).toEqual(['EN_CARTERA', 'DEPOSITADO', 'RECHAZADO', 'DEVUELTO']);
  });
});
