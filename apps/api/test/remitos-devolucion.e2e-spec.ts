import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

type Remito = { id: string; numero: number; tipo: string; renglones: { id: string; cantidad: string; cantidadDevuelta: string; cantidadAAcreditar: string; cantidadFacturada: string }[] };

describe('remitos de devolución (E54)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const e = await prepararPedidos(app, prisma);
    const art = await e.articulo();
    await e.inicial(art.id, 20, 100);
    const entrega = async (cantidad = 10, o: Record<string, unknown> = {}) => {
      const r = await e.remito([{ articuloId: art.id, descripcion: 'Producto', cantidad }], o);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as Remito;
    };
    const devolver = (renglones: { remitoRenglonOrigenId: string; cantidad: number }[], o: Record<string, unknown> = {}) =>
      e.http.post('/api/ventas/remitos/devoluciones', { terceroId: e.clienteRI.id, puntoVentaId: e.puntoVenta.id, fecha: '2026-11-04', renglones, ...o });
    const facturar = (remitoRenglonId: string, cantidad: number, emitir = true) =>
      e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId, descripcion: 'x', cantidad, precioUnitario: 1000, alicuota: 21 }] }), emitir });
    const origen = (id: string) => prisma.remitoRenglon.findUniqueOrThrow({ where: { id } });
    return { ...e, art, entrega, devolver, facturar, origen };
  };

  it('devolución sin facturar: entra el stock al costo, asiento inverso, baja lo pendiente de facturar', async () => {
    const x = await escenario();
    const r = await x.entrega(10);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 4 }]);
    expect([d.status, d.body.tipo]).toEqual([201, 'DEVOLUCION']);
    expect(await x.saldo(x.art.id)).toBe('14');
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: d.body.id, tipo: 'DEVOLUCION_VENTA' } });
    expect(mov.costoUnitario.toString()).toBe('100');
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { origenId: d.body.id } });
    expect(await x.renglonesAsiento(asiento.id)).toEqual([['1.1.05.001', 'D 400.00'], ['5.1.01', 'H 400.00']]);
    const o = await x.origen(r.renglones[0].id);
    expect(o.cantidadDevuelta.toString()).toBe('4');
    expect(d.body.renglones[0].cantidadAAcreditar).toBe('0');
    const pend = (await x.http.get(`/api/ventas/remitos/pendientes-facturar?terceroId=${x.clienteRI.id}`)).body;
    expect(pend.map((p: { pendiente: string }) => p.pendiente)).toEqual(['6']);
    const mas = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 7 }]);
    expect([mas.status, mas.body.message]).toEqual([400, `No se puede devolver más de lo entregado en el remito R 0001-00000001 (Producto): quedan 6`]);
  });

  it('devolución de lo facturado: queda a acreditar; factura sin autorizar bloquea', async () => {
    const x = await escenario();
    const r = await x.entrega(10);
    expect((await x.facturar(r.renglones[0].id, 6)).status).toBe(201);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 6 }]);
    expect(d.status).toBe(201);
    // Había 4 sin facturar: 2 quedan a acreditar
    expect(d.body.renglones[0].cantidadAAcreditar).toBe('2');
    const r2 = await x.entrega(5);
    expect((await x.facturar(r2.renglones[0].id, 2, false)).status).toBe(201);
    const b = await x.devolver([{ remitoRenglonOrigenId: r2.renglones[0].id, cantidad: 1 }]);
    expect([b.status, b.body.message]).toEqual([400, 'El remito tiene una factura sin autorizar: emítala o elimínela antes de la devolución']);
  });

  it('validaciones: otro cliente, mismo depósito, anular entrega con devoluciones', async () => {
    const x = await escenario();
    const r = await x.entrega(10);
    const otro = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 1 }], { terceroId: x.clienteCF.id });
    expect(otro.status).toBe(400);
    await x.inicial(x.art.id, 5, 100, { depositoId: x.deposito2.id });
    const r2 = await x.entrega(2, { depositoId: x.deposito2.id });
    const mix = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 1 }, { remitoRenglonOrigenId: r2.renglones[0].id, cantidad: 1 }]);
    expect([mix.status, mix.body.message]).toEqual([400, 'Los renglones deben ser de remitos del mismo depósito']);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 3 }]);
    const an = await x.http.post(`/api/ventas/remitos/${r.id}/anular`, { motivo: 'x' });
    expect([an.status, an.body.message]).toEqual([400, 'El remito tiene devoluciones: anúlelas primero']);
    // Anular la devolución: vuelve el stock y los pendientes
    expect((await x.http.post(`/api/ventas/remitos/${d.body.id}/anular`, { motivo: 'x' })).status).toBe(201);
    expect(await x.saldo(x.art.id)).toBe('10');
    expect((await x.origen(r.renglones[0].id)).cantidadDevuelta.toString()).toBe('0');
    expect((await x.http.post(`/api/ventas/remitos/${r.id}/anular`, { motivo: 'x' })).status).toBe(201);
  });

  it('artículo sin stock y renglón de pedido: pendientes del pedido', async () => {
    const x = await escenario();
    const srv = await x.articulo(false);
    const p = await x.pedido([x.renglon(srv.id, 5)], { confirmar: true });
    const r = await x.remito([x.dePedido(p.renglones[0].id, 5)]);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.body.renglones[0].id, cantidad: 2 }]);
    expect(d.status).toBe(201);
    expect(await prisma.movimientoStock.count({ where: { origenId: d.body.id } })).toBe(0);
    const pr = await prisma.pedidoVentaRenglon.findUniqueOrThrow({ where: { id: p.renglones[0].id } });
    expect(pr.cantidadDevuelta.toString()).toBe('2');
    const ped = (await x.http.get(`/api/ventas/pedidos/${p.id}`)).body;
    expect(ped.renglones[0].pendienteFacturar).toBe('3');
  });

  it('si la factura ya tiene una nota de crédito con devolución del artículo, no se hace remito de devolución', async () => {
    const x = await escenario();
    const r = await x.entrega(10);
    const f = await x.facturar(r.renglones[0].id, 10);
    const nc = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, devuelveMercaderia: true, renglones: [{ articuloId: x.art.id, descripcion: 'x', cantidad: 2, precioUnitario: 1000, alicuota: 21 }] }), emitir: true });
    expect(nc.status).toBe(201);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 1 }]);
    expect([d.status, d.body.message]).toEqual([400, 'La mercadería de este remito ya se devolvió con una nota de crédito']);
  });

  describe('nota de crédito desde devoluciones', () => {
    const ncDesde = (x: Awaited<ReturnType<typeof escenario>>, facturaId: string, devolucionRenglonId: string, cantidad: number, o: Record<string, unknown> = {}) =>
      x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: facturaId, renglones: [{ origen: 'DEVOLUCION', devolucionRenglonId, descripcion: 'x', cantidad, precioUnitario: 1000, alicuota: 21 }], ...o }), emitir: true });

    it('acredita lo devuelto sin mover stock; pendientes; tope; otra factura; devolución de mercadería', async () => {
      const x = await escenario();
      const r = await x.entrega(10);
      const f1 = await x.facturar(r.renglones[0].id, 10);
      const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 3 }]);
      const dr = d.body.renglones[0].id as string;
      const pend = (await x.http.get(`/api/ventas/remitos/pendientes-acreditar?terceroId=${x.clienteRI.id}`)).body;
      expect(pend.map((p: { devolucionRenglonId: string; pendiente: string; facturaId: string; precioUnitario: string }) => [p.devolucionRenglonId, p.pendiente, p.facturaId, Number(p.precioUnitario)])).toEqual([[dr, '3', f1.body.id, 1000]]);
      const stockAntes = await x.saldo(x.art.id);
      const mal = await ncDesde(x, f1.body.id, dr, 3, { devuelveMercaderia: true });
      expect([mal.status, mal.body.message]).toEqual([400, 'La mercadería ya entró con el remito de devolución']);
      const nc = await ncDesde(x, f1.body.id, dr, 3);
      expect([nc.status, nc.body.estado]).toEqual([201, 'AUTORIZADO']);
      expect(await x.saldo(x.art.id)).toBe(stockAntes);
      expect((await x.origen(dr)).cantidadAcreditada.toString()).toBe('3');
      const otra = await ncDesde(x, f1.body.id, dr, 1);
      expect(otra.status).toBe(400);
      // Con NC no se anula la devolución
      const an = await x.http.post(`/api/ventas/remitos/${d.body.id}/anular`, { motivo: 'x' });
      expect([an.status, an.body.message]).toEqual([400, 'La devolución ya tiene notas de crédito: anúlelas primero']);
    });

    it('factura que no facturó el renglón; tope por factura con dos facturas', async () => {
      const x = await escenario();
      const r = await x.entrega(10);
      const f1 = await x.facturar(r.renglones[0].id, 6);
      const f2 = await x.facturar(r.renglones[0].id, 4);
      const otraEntrega = await x.entrega(2);
      const f3 = await x.facturar(otraEntrega.renglones[0].id, 2);
      const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 8 }]);
      const dr = d.body.renglones[0].id as string;
      let nc = await ncDesde(x, f3.body.id, dr, 1);
      expect([nc.status, nc.body.message]).toEqual([400, 'La devolución no corresponde a la factura asociada']);
      // A menor precio, para que no corte primero el tope de saldo de la factura
      nc = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f2.body.id, renglones: [{ origen: 'DEVOLUCION', devolucionRenglonId: dr, descripcion: 'x', cantidad: 5, precioUnitario: 100, alicuota: 21 }] }) });
      expect(nc.status).toBe(400);
      expect(nc.body.message).toMatch(/^La factura .* facturó 4 de Producto$/);
      expect((await ncDesde(x, f2.body.id, dr, 4)).status).toBe(201);
      expect((await ncDesde(x, f1.body.id, dr, 4)).status).toBe(201);
    });

    it('la nota de crédito con devolución de mercadería descuenta lo devuelto por remito', async () => {
      const x = await escenario();
      const r = await x.entrega(10);
      const f1 = await x.facturar(r.renglones[0].id, 10);
      await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 3 }]);
      const nc = (q: number) => x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f1.body.id, devuelveMercaderia: true, renglones: [{ articuloId: x.art.id, descripcion: 'x', cantidad: q, precioUnitario: 1000, alicuota: 21 }] }) });
      expect((await nc(8)).status).toBe(400);
      expect((await nc(7)).status).toBe(201);
    });
  });

  describe('revisión final', () => {
    it('no se anula una devolución si hay otra posterior del mismo renglón', async () => {
      const x = await escenario();
      const r = await x.entrega(10);
      const a = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 4 }]);
      expect((await x.facturar(r.renglones[0].id, 6)).status).toBe(201);
      expect((await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 6 }])).status).toBe(201);
      const an = await x.http.post(`/api/ventas/remitos/${a.body.id}/anular`, { motivo: 'x' });
      expect([an.status, an.body.message]).toEqual([400, 'El renglón tiene devoluciones posteriores: anúlelas primero']);
    });

    it('la NC con devolución de mercadería cuenta solo lo devuelto a acreditar, una sola vez entre facturas', async () => {
      const x = await escenario();
      const nc = (f: string, q: number) => x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f, devuelveMercaderia: true, renglones: [{ articuloId: x.art.id, descripcion: 'x', cantidad: q, precioUnitario: 1, alicuota: 21 }] }) });
      // Devolución de lo no facturado: la factura conserva sus 4
      const r = await x.entrega(10);
      const f1 = await x.facturar(r.renglones[0].id, 4);
      expect((await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 6 }])).status).toBe(201);
      expect((await nc(f1.body.id, 4)).status).toBe(201);
      // Renglón facturado en dos facturas, devolución de 3: se imputa a una sola (la más reciente)
      const r2 = await x.entrega(10);
      const g1 = await x.facturar(r2.renglones[0].id, 4);
      const g2 = await x.facturar(r2.renglones[0].id, 6);
      expect((await x.devolver([{ remitoRenglonOrigenId: r2.renglones[0].id, cantidad: 3 }])).status).toBe(201);
      expect((await nc(g1.body.id, 4)).status).toBe(201);
      expect((await nc(g2.body.id, 4)).status).toBe(400);
      expect((await nc(g2.body.id, 3)).status).toBe(201);
    });

    it('artículo sin stock facturado desde el pedido: la devolución queda a acreditar', async () => {
      const x = await escenario();
      const srv = await x.articulo(false);
      const p = await x.pedido([x.renglon(srv.id, 10)], { confirmar: true });
      const r = await x.remito([x.dePedido(p.renglones[0].id, 10)]);
      const f = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ renglones: [{ origen: 'PEDIDO', pedidoRenglonId: p.renglones[0].id, descripcion: 'x', cantidad: 10, precioUnitario: 1000, alicuota: 21 }] }), emitir: true });
      expect(f.status).toBe(201);
      const d = await x.devolver([{ remitoRenglonOrigenId: r.body.renglones[0].id, cantidad: 4 }]);
      expect([d.status, d.body.renglones[0].cantidadAAcreditar]).toEqual([201, '4']);
      const ped = (await x.http.get(`/api/ventas/pedidos/${p.id}`)).body;
      expect(ped.renglones[0].pendienteFacturar).toBe('0');
    });

    it('informe de márgenes: la NC desde una devolución resta el costo de salida', async () => {
      const x = await escenario();
      const r = await x.entrega(10);
      const f = await x.facturar(r.renglones[0].id, 10);
      const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 3 }]);
      const nc = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, renglones: [{ origen: 'DEVOLUCION', devolucionRenglonId: d.body.renglones[0].id, descripcion: 'x', cantidad: 3, precioUnitario: 1000, alicuota: 21 }] }), emitir: true });
      expect(nc.status).toBe(201);
      const inf = (await x.http.get('/api/informes/ventas?desde=2026-11-01&hasta=2026-11-30&agrupar=cliente')).body;
      expect(inf.totales).toMatchObject({ ventas: '7000.00', costo: '700.00' });
    });
  });

  it('PDF del remito de devolución y listado por tipo', async () => {
    const x = await escenario();
    const r = await x.entrega(10);
    const d = await x.devolver([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: 2 }]);
    const pdf = await x.pdfTexto(`/api/ventas/remitos/${d.body.id}/pdf`);
    const texto = pdf.texto + [...pdf.texto.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
    expect(texto).toContain('Remito de devoluci');
    expect(texto).toContain('R 0001-00000001');
    const lista = (await x.http.get('/api/ventas/remitos?tipo=DEVOLUCION')).body as { id: string; tipo: string }[];
    expect(lista.map((y) => [y.id, y.tipo])).toEqual([[d.body.id, 'DEVOLUCION']]);
  });
});

