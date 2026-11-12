import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('ventas: remitos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conPedido(cantidad = 30) {
    const e = await prepararPedidos(app, prisma);
    const a = await e.articulo();
    await e.inicial(a.id, 100, 1500);
    const p = await e.pedido([e.renglon(a.id, cantidad, 2500)], { confirmar: true });
    const renglonPedido = async () => (await prisma.pedidoVentaRenglon.findFirstOrThrow({ where: { pedidoId: p.id } })).cantidadEntregada.toString();
    const estadoPedido = async () => (await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: p.id } })).estado;
    return { ...e, a, p, pr: p.renglones[0].id, renglonPedido, estadoPedido };
  }

  it('el circuito del criterio de éxito', async () => {
    const e = await conPedido();
    const r1 = await e.remito([e.dePedido(e.pr, 20)]);
    expect(r1.status).toBe(201);
    expect(r1.body.numero).toBe(1);
    expect(await e.estado(e.a.id)).toMatchObject({ cantidad: '80', valor: '120000' });
    expect(await e.renglonesAsiento(r1.body.asientoId)).toEqual([['1.1.05.001', 'H 30000.00'], ['5.1.01', 'D 30000.00']]);
    expect(await e.estadoPedido()).toBe('PARCIALMENTE_ENTREGADO');
    expect(await e.renglonPedido()).toBe('20');
    const r2 = await e.remito([e.dePedido(e.pr, 10)]);
    expect(await e.estadoPedido()).toBe('ENTREGADO');
    expect((await e.pdfTexto(`/api/ventas/remitos/${r2.body.id}/pdf`)).texto).toContain('(Remito Nro. 0001-00000002');
  });

  it('tope de entrega y cliente', async () => {
    const e = await conPedido();
    expect((await e.remito([e.dePedido(e.pr, 31)])).body.message).toBe('La cantidad a entregar (31) supera lo pendiente del pedido (30)');
    expect((await e.remito([e.dePedido(e.pr, 20), e.dePedido(e.pr, 20)])).body.message).toBe('La cantidad a entregar (40) supera lo pendiente del pedido (30)');
    expect((await e.remito([e.dePedido(e.pr, 1)], { terceroId: e.clienteCF.id })).body.message).toBe('Todos los renglones deben ser del cliente indicado');
    const presupuesto = await e.pedido([e.renglon(e.a.id, 5)]);
    expect((await e.remito([e.dePedido(presupuesto.renglones[0].id, 1)])).body.message).toBe('El pedido no está confirmado');
  });

  it('remito directo', async () => {
    const e = await conPedido();
    const sin = await e.articulo(false);
    const r = await e.remito([{ articuloId: e.a.id, descripcion: 'Suelto', cantidad: 5 }, { articuloId: sin.id, descripcion: 'Sin stock', cantidad: 2 }]);
    expect(r.status).toBe(201);
    expect(await e.estado(e.a.id)).toMatchObject({ cantidad: '95' });
    expect(await prisma.movimientoStock.count({ where: { origenId: r.body.id } })).toBe(1);
    expect((await e.remito([{ descripcion: 'Nada', cantidad: 1 }], { depositoId: null, puntoVentaId: e.puntoVenta.id })).status).toBe(201);
  });

  it('anula y devuelve stock y pedido', async () => {
    const e = await conPedido();
    const r = await e.remito([e.dePedido(e.pr, 20)]);
    const a = await e.http.post(`/api/ventas/remitos/${r.body.id}/anular`, { motivo: 'Error' });
    expect(a.status).toBe(201);
    expect(a.body.estado).toBe('ANULADO');
    expect(a.body.asientoAnulacionId).toBeTruthy();
    expect(await e.estado(e.a.id)).toMatchObject({ cantidad: '100', valor: '150000' });
    expect([await e.estadoPedido(), await e.renglonPedido()]).toEqual(['CONFIRMADO', '0']);
    const r2 = await e.remito([e.dePedido(e.pr, 5)]);
    await prisma.remitoRenglon.updateMany({ where: { remitoId: r2.body.id }, data: { cantidadFacturada: 1 } });
    const no = await e.http.post(`/api/ventas/remitos/${r2.body.id}/anular`, { motivo: 'Error' });
    expect(no.status).toBe(400);
    expect(no.body.message).toBe('El remito tiene renglones facturados');
  });

  it('anular un remito de un pedido cerrado', async () => {
    const e = await conPedido();
    const r = await e.remito([e.dePedido(e.pr, 20)]);
    await e.http.post(`/api/ventas/pedidos/${e.p.id}/cerrar`, { motivo: 'No quiere el resto' });
    expect((await e.http.post(`/api/ventas/remitos/${r.body.id}/anular`, { motivo: 'Error' })).status).toBe(201);
    expect([await e.estadoPedido(), await e.renglonPedido()]).toEqual(['CERRADO', '0']);
  });

  it('dos remitos simultáneos por lo pendiente', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const e = await conPedido(10);
      const rs = await Promise.all([e.remito([e.dePedido(e.pr, 10)]), e.remito([e.dePedido(e.pr, 10)])]);
      expect(rs.map((x) => x.status).sort()).toEqual([201, 400]);
      expect(await e.renglonPedido()).toBe('10');
    }
  });

  it('pendientes de facturar', async () => {
    const e = await conPedido();
    const r = await e.remito([e.dePedido(e.pr, 20)]);
    const p = (await e.http.get(`/api/ventas/remitos/pendientes-facturar?terceroId=${e.clienteRI.id}`)).body;
    expect(p).toEqual([expect.objectContaining({ remitoId: r.body.id, numero: 'R 0001-00000001', pendiente: '20', articuloId: e.a.id })]);
  });
});
