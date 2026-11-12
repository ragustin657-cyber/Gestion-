import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('ventas: facturación desde remitos y pedidos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conRemito() {
    const e = await prepararPedidos(app, prisma);
    const a = await e.articulo();
    await e.inicial(a.id, 100, 1500);
    const p = await e.pedido([e.renglon(a.id, 30, 2500)], { confirmar: true });
    const rem = (await e.remito([e.dePedido(p.renglones[0].id, 20)])).body as { id: string; renglones: { id: string }[] };
    const rr = rem.renglones[0].id;
    const deRemito = (cantidad: number, precioUnitario = 2500) => ({ origen: 'REMITO', remitoRenglonId: rr, descripcion: 'x', cantidad, precioUnitario, alicuota: 21 });
    const factura = (renglones: Record<string, unknown>[], o: Record<string, unknown> = {}, emitir = true) =>
      e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones, ...o }), emitir });
    const facturado = async () => [(await prisma.remitoRenglon.findUniqueOrThrow({ where: { id: rr } })).cantidadFacturada.toString(), (await prisma.pedidoVentaRenglon.findUniqueOrThrow({ where: { id: p.renglones[0].id } })).cantidadFacturada.toString()];
    return { ...e, a, p, rem, rr, deRemito, factura, facturado };
  }

  it('factura del remito no mueve stock ni registra costo', async () => {
    const e = await conRemito();
    const f = await e.factura([e.deRemito(20)]);
    expect(f.status).toBe(201);
    expect(f.body.estado).toBe('AUTORIZADO');
    expect(await e.estado(e.a.id)).toMatchObject({ cantidad: '80' });
    expect(await prisma.asiento.count({ where: { origenTipo: 'COSTO_VENTA', origenId: f.body.id } })).toBe(0);
    expect(await e.facturado()).toEqual(['20', '20']);
    const ren = await prisma.comprobanteVentaRenglon.findFirstOrThrow({ where: { comprobanteId: f.body.id } });
    expect([ren.articuloId, ren.remitoRenglonId, ren.pedidoRenglonId]).toEqual([e.a.id, e.rr, e.p.renglones[0].id]);
  });

  it('tope de facturación', async () => {
    const e = await conRemito();
    const r = await e.factura([e.deRemito(21)]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cantidad a facturar (21) supera lo pendiente del remito (20)');
  });

  it('borrador eliminado o rechazado no consume', async () => {
    const e = await conRemito();
    const b = await e.factura([e.deRemito(20)], {}, false);
    expect(b.status).toBe(201);
    expect(await e.facturado()).toEqual(['0', '0']);
    expect((await e.http.delete(`/api/ventas/comprobantes/${b.body.id}`)).status).toBe(200);
    expect((await e.factura([e.deRemito(20)])).body.estado).toBe('AUTORIZADO');
  });

  it('la segunda factura del mismo remito se rechaza antes del CAE', async () => {
    const e = await conRemito();
    const b1 = await e.factura([e.deRemito(20)], {}, false);
    const b2 = await e.factura([e.deRemito(20)], {}, false);
    expect((await e.http.post(`/api/ventas/comprobantes/${b1.body.id}/emitir`, {})).body.estado).toBe('AUTORIZADO');
    const r = await e.http.post(`/api/ventas/comprobantes/${b2.body.id}/emitir`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cantidad a facturar (20) supera lo pendiente del remito (0)');
    expect((await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: b2.body.id } })).numeroReservado).toBeNull();
  });

  it('desde pedido solo servicios', async () => {
    const e = await conRemito();
    const servicio = await prisma.articulo.create({ data: { empresaId: e.empresaId, codigo: 'SRV', descripcion: 'Instalación', alicuotaIva: 21, esServicio: true } });
    const p = await e.pedido([e.renglon(servicio.id, 1, 5000), e.renglon(e.a.id, 2, 2500)], { confirmar: true });
    const ok = await e.factura([{ origen: 'PEDIDO', pedidoRenglonId: p.renglones[0].id, descripcion: 'x', cantidad: 1, precioUnitario: 5000, alicuota: 21 }]);
    expect(ok.status).toBe(201);
    expect((await prisma.pedidoVentaRenglon.findUniqueOrThrow({ where: { id: p.renglones[0].id } })).cantidadFacturada.toString()).toBe('1');
    const no = await e.factura([{ origen: 'PEDIDO', pedidoRenglonId: p.renglones[1].id, descripcion: 'x', cantidad: 1, precioUnitario: 2500, alicuota: 21 }]);
    expect(no.body.message).toBe('Los artículos que controlan stock se facturan desde un remito o como venta directa');
  });

  it('NC solo con renglones directos', async () => {
    const e = await conRemito();
    const f = await e.factura([e.deRemito(10)]);
    const r = await e.factura([e.deRemito(1)], { tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id });
    expect(r.body.message).toBe('Las notas de crédito y débito solo admiten renglones directos');
  });

  it('NC con devolución de una factura de remitos', async () => {
    const e = await conRemito();
    const f = await e.factura([e.deRemito(20)]);
    const nc = (cantidad: number) => e.factura([{ articuloId: e.a.id, descripcion: 'Devolución', cantidad, precioUnitario: 100, alicuota: 21 }], { tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, devuelveMercaderia: true });
    const mucho = await nc(21);
    expect(mucho.body.message).toBe('No se puede devolver más de lo vendido de ART-1');
    const ok = await nc(5);
    expect(ok.status).toBe(201);
    const m = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: ok.body.id } });
    expect([m.tipo, m.costoUnitario.toString(), m.importe.toString()]).toEqual(['DEVOLUCION_VENTA', '1500', '7500']);
  });

  it('factura de un remito en USD', async () => {
    const e = await conRemito();
    const f = await e.factura([e.deRemito(20, 2)], { monedaCodigo: 'USD', cotizacion: 1250 });
    expect(f.status).toBe(201);
    expect(f.body.total).toBe('48.4');
    expect(await prisma.movimientoStock.count({ where: { origenId: f.body.id } })).toBe(0);
  });

  it('pendientes para facturar', async () => {
    const e = await conRemito();
    const r = (await e.http.get(`/api/ventas/pendientes-facturar?terceroId=${e.clienteRI.id}`)).body;
    expect(r.remitos).toEqual([expect.objectContaining({ remitoRenglonId: e.rr, pendiente: '20' })]);
    expect(r.pedidos).toEqual([]);
  });
});
