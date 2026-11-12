import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('ventas completas: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('no se anula un remito con una factura en emisión', async () => {
    const e = await prepararPedidos(app, prisma);
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const rem = (await e.remito([{ articuloId: a.id, descripcion: 'x', cantidad: 5 }])).body;
    const b = await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId: rem.renglones[0].id, descripcion: 'x', cantidad: 5, precioUnitario: 100, alicuota: 21 }] }));
    expect(b.status).toBe(201);
    await prisma.comprobanteVenta.update({ where: { id: b.body.id }, data: { emisionEnCurso: new Date() } });
    const r = await e.http.post(`/api/ventas/remitos/${rem.id}/anular`, { motivo: 'Error' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El remito tiene una factura en emisión: espere a que termine');
  });

  it('un servicio facturado desde el pedido no se vuelve a facturar desde su remito', async () => {
    const e = await prepararPedidos(app, prisma);
    const srv = await prisma.articulo.create({ data: { empresaId: e.empresaId, codigo: 'SRV', descripcion: 'Flete', alicuotaIva: 21, esServicio: true } });
    const p = await e.pedido([e.renglon(srv.id, 1, 5000)], { confirmar: true });
    const f = await e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones: [{ origen: 'PEDIDO', pedidoRenglonId: p.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 5000, alicuota: 21 }] }), emitir: true });
    expect(f.body.estado).toBe('AUTORIZADO');
    const rem = (await e.remito([e.dePedido(p.renglones[0].id, 1)])).body;
    const r = await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId: rem.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 5000, alicuota: 21 }] }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cantidad a facturar (1) supera lo pendiente del pedido (0)');
  });

  it('un remito y la anulación del pedido simultáneos no dejan un pedido anulado con entregas', async () => {
    for (let i = 0; i < 6; i++) {
      await limpiarBase(prisma);
      const e = await prepararPedidos(app, prisma);
      const p = await e.pedido([e.renglon(null, 5)], { confirmar: true });
      await Promise.all([e.remito([e.dePedido(p.renglones[0].id, 5)]), e.http.post(`/api/ventas/pedidos/${p.id}/anular`, { motivo: 'x' })]);
      const ped = await prisma.pedidoVenta.findUniqueOrThrow({ where: { id: p.id }, include: { renglones: true } });
      expect(ped.estado === 'ANULADO' && Number(ped.renglones[0].cantidadEntregada) > 0).toBe(false);
    }
  });

  it('pendientes de facturar traen el precio y la moneda del pedido', async () => {
    const e = await prepararPedidos(app, prisma);
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const p = await e.pedido([e.renglon(a.id, 5, 20)], { confirmar: true, monedaCodigo: 'USD', cotizacion: 1000 });
    await e.remito([e.dePedido(p.renglones[0].id, 5)]);
    const r = (await e.http.get(`/api/ventas/pendientes-facturar?terceroId=${e.clienteRI.id}`)).body;
    expect(r.remitos[0]).toMatchObject({ precioPedido: '20', alicuotaPedido: '21', monedaPedido: 'USD', cotizacionPedido: '1000' });
  });
});
