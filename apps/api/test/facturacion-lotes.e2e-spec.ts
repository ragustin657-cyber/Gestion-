import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

type Grupo = { terceroId: string; razonSocial: string; letra: string; monedaCodigo: string; cotizacion: string | null; remitos: string[]; renglones: { remitoRenglonId: string; cantidad: string; precioUnitario: string | null; bonificacionPct: string; alicuota: string; importe: string | null }[]; total: string; problemas: string[]; avisos: string[] };

describe('facturación por lotes (E55)', () => {
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
    const art = await e.articulo(false);
    const alta = async (razonSocial: string, cuit: string) => {
      const r = await e.http.post('/api/terceros', { esCliente: true, razonSocial, cuit, condicionIva: 'RESPONSABLE_INSCRIPTO', diasPago: 10 });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const otro = await alta('Almacén Sur SRL', '30-71234567-1');
    /** Pedido confirmado y remito completo de un cliente. */
    const pedidoYRemito = async (terceroId: string, cantidad = 10, o: { precio?: number; bonificacionPct?: number; pedido?: Record<string, unknown>; fecha?: string } = {}) => {
      const p = await e.pedido([{ ...e.renglon(art.id, cantidad, o.precio ?? 1000), ...(o.bonificacionPct ? { bonificacionPct: o.bonificacionPct } : {}) }], { terceroId, confirmar: true, ...o.pedido });
      const r = await e.remito([e.dePedido(p.renglones[0].id, cantidad)], { terceroId, ...(o.fecha ? { fecha: o.fecha } : {}) });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; renglones: { id: string }[] };
    };
    const vista = async (q: string) => {
      const r = await e.http.get(`/api/ventas/facturacion-lotes/vista-previa?hasta=2026-11-30&fecha=2026-11-06${q}`);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      return r.body as Grupo[];
    };
    return { ...e, art, otro, alta, pedidoYRemito, vista };
  };

  describe('vista previa', () => {
    it('agrupa por cliente con el precio y la bonificación del pedido', async () => {
      const x = await escenario();
      await x.pedidoYRemito(x.clienteRI.id, 10, { precio: 1000, bonificacionPct: 10 });
      await x.pedidoYRemito(x.otro.id, 2, { precio: 500 });
      const g = await x.vista('');
      expect(g.map((y) => [y.razonSocial, y.letra, y.monedaCodigo, y.total, y.problemas])).toEqual([
        ['Almacén Sur SRL', 'A', 'ARS', '1000.00', []],
        ['Distribuidora Norte SA', 'A', 'ARS', '9000.00', []],
      ]);
      expect(g[1].renglones[0]).toMatchObject({ cantidad: '10', precioUnitario: '1000', bonificacionPct: '10', alicuota: '21' });
      expect(g[1].remitos).toEqual(['R 0001-00000001']);
      expect((await x.vista(`&terceroIds=${x.otro.id}`)).map((y) => y.razonSocial)).toEqual(['Almacén Sur SRL']);
    });

    it('sin pedido: precio de la lista; sin precio: problema; posteriores a la fecha de corte no entran', async () => {
      const x = await escenario();
      const lista = (await x.http.post('/api/ventas/listas', { nombre: 'General', monedaCodigo: 'ARS', porDefecto: true })).body as { id: string };
      expect((await x.http.put(`/api/ventas/listas/${lista.id}/precios/${x.art.id}`, { precio: 1500 })).status).toBe(200);
      const sinPrecio = await x.articulo(false);
      expect((await x.remito([{ articuloId: x.art.id, descripcion: 'Producto', cantidad: 3 }])).status).toBe(201);
      expect((await x.remito([{ articuloId: sinPrecio.id, descripcion: 'Cable', cantidad: 1 }], { terceroId: x.otro.id })).status).toBe(201);
      await x.pedidoYRemito(x.clienteRI.id, 1, { fecha: '2026-12-05' });
      const g = await x.vista('');
      const ri = g.find((y) => y.terceroId === x.clienteRI.id)!;
      expect(ri.renglones.map((r) => [r.cantidad, r.precioUnitario, r.bonificacionPct])).toEqual([['3', '1500', '0']]);
      expect(ri.total).toBe('4500.00');
      const sur = g.find((y) => y.terceroId === x.otro.id)!;
      expect(sur.problemas).toEqual(['Sin precio: Cable (remito R 0001-00000002)']);
    });

    it('solo lo pendiente (facturado y devuelto); lo que está en un borrador queda afuera con aviso', async () => {
      const x = await escenario();
      const r = await x.remito([{ articuloId: x.art.id, descripcion: 'Producto', cantidad: 10 }]);
      const rr = r.body.renglones[0].id as string;
      const fac = await x.http.post('/api/ventas/comprobantes', { ...x.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId: rr, descripcion: 'x', cantidad: 4, precioUnitario: 1000, alicuota: 21 }] }), emitir: true });
      expect(fac.status).toBe(201);
      expect((await x.http.post('/api/ventas/remitos/devoluciones', { terceroId: x.clienteRI.id, puntoVentaId: x.puntoVenta.id, fecha: '2026-11-04', renglones: [{ remitoRenglonOrigenId: rr, cantidad: 2 }] })).status).toBe(201);
      await x.pedidoYRemito(x.clienteRI.id, 5);
      const lista = (await x.http.post('/api/ventas/listas', { nombre: 'General', monedaCodigo: 'ARS', porDefecto: true })).body as { id: string };
      await x.http.put(`/api/ventas/listas/${lista.id}/precios/${x.art.id}`, { precio: 100 });
      let g = await x.vista('');
      expect(g[0].renglones.map((y) => y.cantidad)).toEqual(['4', '5']);
      // Un borrador con el renglón del primer remito
      expect((await x.http.post('/api/ventas/comprobantes', { ...x.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId: rr, descripcion: 'x', cantidad: 1, precioUnitario: 1000, alicuota: 21 }] }) })).status).toBe(201);
      g = await x.vista('');
      expect(g[0].renglones.map((y) => y.cantidad)).toEqual(['5']);
      expect(g[0].avisos).toEqual(['Ya está en la factura borrador sin autorizar']);
      expect(g[0].problemas).toEqual([]);
    });

    it('pedido en USD: factura aparte, con cotización de la fecha; sin cotización, problema', async () => {
      const x = await escenario();
      await x.pedidoYRemito(x.clienteRI.id, 2, { precio: 10, pedido: { monedaCodigo: 'USD', cotizacion: 1000 } });
      await x.pedidoYRemito(x.clienteRI.id, 1, { precio: 500 });
      let g = await x.vista('');
      expect(g.map((y) => [y.monedaCodigo, y.problemas])).toEqual([['ARS', []], ['USD', ['No hay cotización de USD para la fecha']]]);
      await x.cotizacionUsd('2026-11-06', 1100);
      g = await x.vista('');
      expect(g.map((y) => [y.monedaCodigo, y.cotizacion, y.total, y.problemas])).toEqual([['ARS', null, '500.00', []], ['USD', '1100', '20.00', []]]);
    });
  });
});
