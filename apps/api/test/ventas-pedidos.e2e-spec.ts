import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('ventas: pedidos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('presupuesto editable y confirmación', async () => {
    const e = await prepararPedidos(app, prisma);
    const p = await e.pedido([e.renglon(null, 1)]);
    expect(p).toMatchObject({ estado: 'PRESUPUESTO', numero: 1, total: '1210' });
    const datos = { terceroId: e.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', renglones: [e.renglon(null, 2)] };
    const m = await e.http.put(`/api/ventas/pedidos/${p.id}`, { ...datos, version: p.version });
    expect(m.status).toBe(200);
    expect(m.body.total).toBe('2420');
    const vieja = await e.http.put(`/api/ventas/pedidos/${p.id}`, { ...datos, version: p.version });
    expect(vieja.status).toBe(409);
    expect(vieja.body.message).toBe('El pedido fue modificado por otro usuario: actualice la pantalla');
    const c = await e.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
    expect(c.status).toBe(201);
    expect(c.body.estado).toBe('CONFIRMADO');
    const tarde = await e.http.put(`/api/ventas/pedidos/${p.id}`, { ...datos, version: c.body.version });
    expect(tarde.body.message).toBe('Solo se modifica un presupuesto');
    const directo = await e.pedido([e.renglon(null, 1)], { confirmar: true });
    expect(directo.estado).toBe('CONFIRMADO');
  });

  it('avisa stock al confirmar', async () => {
    const e = await prepararPedidos(app, prisma);
    const a = await e.articulo();
    await e.inicial(a.id, 5, 10);
    const p = await e.pedido([e.renglon(a.id, 8)]);
    const c = await e.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
    expect(c.body.advertencias).toEqual(['Stock disponible de ART-1 en Central: 5, el pedido pide 8']);
  });

  it('cierra y anula', async () => {
    const e = await prepararPedidos(app, prisma);
    const p1 = await e.pedido([e.renglon(null, 1)], { confirmar: true });
    const c = await e.http.post(`/api/ventas/pedidos/${p1.id}/cerrar`, { motivo: 'El cliente desistió' });
    expect(c.body).toMatchObject({ estado: 'CERRADO', motivoCierre: 'El cliente desistió' });
    const p2 = await e.pedido([e.renglon(null, 1)]);
    expect((await e.http.post(`/api/ventas/pedidos/${p2.id}/anular`, { motivo: 'Error' })).body.estado).toBe('ANULADO');
    const p3 = await e.pedido([e.renglon(null, 3)], { confirmar: true });
    await prisma.pedidoVentaRenglon.updateMany({ where: { pedidoId: p3.id }, data: { cantidadEntregada: 1 } });
    const r = await e.http.post(`/api/ventas/pedidos/${p3.id}/anular`, { motivo: 'Error' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El pedido tiene entregas o facturas: ciérrelo en vez de anularlo');
    expect((await e.http.post(`/api/ventas/pedidos/${p1.id}/confirmar`, {})).status).toBe(400);
  });

  it('pdf con título según estado', async () => {
    const e = await prepararPedidos(app, prisma);
    const p = await e.pedido([e.renglon(null, 1)]);
    const a = await e.pdfTexto(`/api/ventas/pedidos/${p.id}/pdf`);
    expect(a.status).toBe(200);
    expect(a.tipo).toContain('pdf');
    expect(a.texto).toContain('(Presupuesto N');
    await e.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
    expect((await e.pdfTexto(`/api/ventas/pedidos/${p.id}/pdf`)).texto).toContain('(Pedido de venta N');
  });

  it('lista con filtros', async () => {
    const e = await prepararPedidos(app, prisma);
    await e.pedido([e.renglon(null, 1)]);
    const c = await e.pedido([e.renglon(null, 2)], { confirmar: true });
    const conf = (await e.http.get('/api/ventas/pedidos?estado=CONFIRMADO')).body;
    expect(conf.map((x: { id: string }) => x.id)).toEqual([c.id]);
    const pend = (await e.http.get('/api/ventas/pedidos?pendientes=entregar')).body;
    expect(pend.map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect(pend[0].renglones[0]).toMatchObject({ pendienteEntregar: '2', pendienteFacturar: '2' });
  });
});
