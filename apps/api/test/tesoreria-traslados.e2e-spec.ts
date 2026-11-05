import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('traslados de valores', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** ROS recibe un cobro (10.000 en efectivo + cheque de 50.000) y lo envía a CEN con 4.000 de efectivo. */
  async function enviado() {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cajaId: t.cajaRos.id, efectivo: 10000, cheques: [t.cheque(50000)] }, t.rosario);
    const chequeId = ing.cheques[0].id;
    const r = await t.rosario.post('/api/tesoreria/traslados', {
      fecha: '2026-11-11', cajaOrigenId: t.cajaRos.id, cajaDestinoId: t.cajaCen.id, cheques: [chequeId], efectivo: { importe: 4000 }, observaciones: 'Rendición',
    });
    return { t, ing, chequeId, r };
  }

  it('envío: cheque en tránsito, egreso de caja y asiento contra valores en tránsito', async () => {
    const { t, chequeId, r } = await enviado();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ numero: 1, estado: 'ENVIADO' });
    expect(r.body.items).toHaveLength(2);
    expect((await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).estado).toBe('EN_TRANSITO');
    expect(await t.saldoCaja(t.cajaRos.id)).toBe(6000);
    expect(await t.asiento(r.body.asientoId)).toEqual({ '1.1.01.005': ['4000', '0'], '1.1.01.001': ['0', '4000'] });
    expect((await t.http.get('/api/tesoreria/traslados?estado=ENVIADO')).body.items).toHaveLength(1);
    expect((await t.rosario.get(`/api/tesoreria/traslados/${r.body.id}`)).status).toBe(200);
  });

  it('recepción total en CEN', async () => {
    const { t, chequeId, r } = await enviado();
    const rec = await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, {
      items: r.body.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })),
    });
    expect(rec.status).toBe(200);
    expect(rec.body.estado).toBe('RECIBIDO');
    const ch = await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId }, include: { historial: true } });
    expect(ch).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaCen.id });
    expect(ch.historial).toHaveLength(3);
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(4000);
    expect(await t.asiento(rec.body.asientoRecepcionId)).toEqual({ '1.1.01.001': ['4000', '0'], '1.1.01.005': ['0', '4000'] });
    expect((await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, {
      items: r.body.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })),
    })).status).toBe(400);
  });

  it('recepción parcial: el cheque rechazado vuelve a ROS; sin motivo → 400', async () => {
    const { t, chequeId, r } = await enviado();
    const ch = r.body.items.find((i: { tipo: string }) => i.tipo === 'CHEQUE');
    const ef = r.body.items.find((i: { tipo: string }) => i.tipo === 'EFECTIVO');
    const sinMotivo = await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, { items: [{ itemId: ch.id, aceptado: false }, { itemId: ef.id, aceptado: true }] });
    expect(sinMotivo.status).toBe(400);
    const incompleto = await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, { items: [{ itemId: ef.id, aceptado: true }] });
    expect(incompleto.status).toBe(400);
    const rec = await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, {
      items: [{ itemId: ch.id, aceptado: false, motivo: 'Cheque sin firma' }, { itemId: ef.id, aceptado: true }],
    });
    expect(rec.status).toBe(200);
    expect(rec.body.estado).toBe('RECIBIDO_PARCIAL');
    expect(await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaRos.id });
    expect(rec.body.items.find((i: { id: string }) => i.id === ch.id)).toMatchObject({ aceptado: false, motivoRechazo: 'Cheque sin firma' });
  });

  it('efectivo rechazado vuelve a la caja de origen con su asiento', async () => {
    const { t, r } = await enviado();
    const rec = await t.http.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, {
      items: r.body.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: false, motivo: 'No llegó' })),
    });
    expect(rec.body.estado).toBe('RECIBIDO_PARCIAL');
    expect(await t.saldoCaja(t.cajaRos.id)).toBe(10000);
    expect(await t.saldoCaja(t.cajaCen.id)).toBe(0);
    expect(await t.asiento(rec.body.asientoRecepcionId)).toEqual({ '1.1.01.001': ['4000', '0'], '1.1.01.005': ['0', '4000'] });
  });

  it('efectivo mayor al saldo, cajas iguales y monedas distintas → 400', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.ingresar({ efectivo: 1000 });
    const base = { fecha: '2026-11-11', cajaOrigenId: t.cajaCen.id, cajaDestinoId: t.cajaRos.id, cheques: [] };
    const saldo = await t.http.post('/api/tesoreria/traslados', { ...base, efectivo: { importe: 1000.01 } });
    expect(saldo.status).toBe(400);
    expect(saldo.body.message).toBe('Saldo insuficiente en la caja');
    expect((await t.http.post('/api/tesoreria/traslados', { ...base, cajaDestinoId: t.cajaCen.id, efectivo: { importe: 1 } })).status).toBe(400);
    const moneda = await t.http.post('/api/tesoreria/traslados', { ...base, cajaDestinoId: t.cajaUsd.id, efectivo: { importe: 1 } });
    expect(moneda.status).toBe(400);
    expect(moneda.body.message).toBe('La moneda del valor no coincide con la de la cuenta o caja de destino');
    expect((await t.http.post('/api/tesoreria/traslados', { ...base })).status).toBe(400);
  });

  it('permisos y alcance: sin tesoreria.aceptar → 403; usuario de ROS sobre un traslado con destino CEN → 404', async () => {
    const { t, r } = await enviado();
    const items = r.body.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true }));
    expect((await t.rosario.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, { items })).status).toBe(403);
    const rosAceptar = await t.usuario(['tesoreria.ver', 'tesoreria.operar', 'tesoreria.aceptar'], t.ros.id);
    expect((await rosAceptar.post(`/api/tesoreria/traslados/${r.body.id}/recibir`, { items })).status).toBe(404);
    // Un usuario de CEN no puede enviar desde la caja de ROS
    const cenUser = await t.usuario(['tesoreria.ver', 'tesoreria.operar'], t.cen.id);
    const desdeRos = await cenUser.post('/api/tesoreria/traslados', { fecha: '2026-11-11', cajaOrigenId: t.cajaRos.id, cajaDestinoId: t.cajaCen.id, cheques: [], efectivo: { importe: 1 } });
    expect(desdeRos.status).toBe(404);
    expect((await cenUser.get(`/api/tesoreria/traslados/${r.body.id}`)).status).toBe(200);
  });

  it('anular un traslado enviado devuelve todo al origen; un recibido no se anula', async () => {
    const { t, chequeId, r } = await enviado();
    const anulador = await t.usuario(['tesoreria.anular'], t.ros.id);
    const a = await anulador.post(`/api/tesoreria/traslados/${r.body.id}/anular`, { motivo: 'Me equivoqué' });
    expect(a.status).toBe(200);
    expect(a.body.estado).toBe('ANULADO');
    expect(await prisma.chequeTercero.findUniqueOrThrow({ where: { id: chequeId } })).toMatchObject({ estado: 'EN_CARTERA', cajaId: t.cajaRos.id });
    expect(await t.saldoCaja(t.cajaRos.id)).toBe(10000);
    expect(await t.asiento(a.body.asientoAnulacionId)).toEqual({ '1.1.01.005': ['0', '4000'], '1.1.01.001': ['4000', '0'] });

    const r2 = await t.rosario.post('/api/tesoreria/traslados', { fecha: '2026-11-11', cajaOrigenId: t.cajaRos.id, cajaDestinoId: t.cajaCen.id, cheques: [chequeId] });
    await t.http.post(`/api/tesoreria/traslados/${r2.body.id}/recibir`, { items: r2.body.items.map((i: { id: string }) => ({ itemId: i.id, aceptado: true })) });
    expect((await t.http.post(`/api/tesoreria/traslados/${r2.body.id}/anular`, { motivo: 'x' })).status).toBe(400);
  });

  it('el ingreso original ya no se puede anular después del traslado', async () => {
    const { t, ing } = await enviado();
    const a = await t.http.post(`/api/tesoreria/ingresos/${ing.id}/anular`, { motivo: 'x' });
    expect(a.status).toBe(400);
    expect(a.body.message).toBe('Hay valores de este ingreso que ya se movieron');
  });

  it('dos traslados simultáneos del mismo cheque: uno entra y el otro 409', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cheques: [t.cheque(100)] });
    const body = { fecha: '2026-11-11', cajaOrigenId: t.cajaCen.id, cajaDestinoId: t.cajaRos.id, cheques: [ing.cheques[0].id] };
    const res = await Promise.all([t.http.post('/api/tesoreria/traslados', body), t.http.post('/api/tesoreria/traslados', body)]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(res.find((x) => x.status === 409)!.body.message).toBe(`El cheque ${ing.cheques[0].numero} ya no está disponible`);
  });
});
