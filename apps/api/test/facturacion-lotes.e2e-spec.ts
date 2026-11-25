import { INestApplication } from '@nestjs/common';
import { ArcaSimulado } from '../src/arca/arca-simulado';
import { ArcaSimuladoFce } from '../src/arca/arca-simulado-fce';
import { PrismaService } from '../src/prisma/prisma.service';
import { LotesFacturacionService } from '../src/ventas/lotes/lotes.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

type Lote = { id: string; numero: number; estado: string; emitidas: number; sinCae: number; errores: number; omitidas: number; items: { terceroId: string; razonSocial: string; comprobanteId: string | null; factura: string | null; resultado: string; fce: boolean; mensaje: string | null; total: string }[] };
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
    const generar = (terceroIds: string[], o: Record<string, unknown> = {}) =>
      e.http.post('/api/ventas/facturacion-lotes', { hasta: '2026-11-30', fecha: '2026-11-06', puntoVentaId: e.puntoVenta.id, terceroIds, ...o });
    return { ...e, art, otro, alta, pedidoYRemito, vista, generar };
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

  describe('generación', () => {
    afterEach(() => {
      ArcaSimulado.forzarFalla('', null);
      LotesFacturacionService.tope = 200;
    });

    it('una factura emitida por cliente; el lote queda registrado; repetir no duplica', async () => {
      const x = await escenario();
      const r1 = await x.pedidoYRemito(x.clienteRI.id, 10);
      await x.pedidoYRemito(x.otro.id, 2, { precio: 500 });
      const g = await x.generar([x.clienteRI.id, x.otro.id]);
      expect(g.status).toBe(201);
      const lote = g.body as Lote;
      expect(lote).toMatchObject({ numero: 1, estado: 'TERMINADO', emitidas: 2, sinCae: 0, errores: 0, omitidas: 0 });
      expect(lote.items.map((i) => [i.razonSocial, i.resultado, i.total])).toEqual([['Almacén Sur SRL', 'EMITIDA', '1210'], ['Distribuidora Norte SA', 'EMITIDA', '12100']]);
      expect(lote.items[1].factura).toMatch(/^A 0001-\d{8}$/);
      const f = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: lote.items[1].comprobanteId! }, include: { renglones: true } });
      expect(f).toMatchObject({ estado: 'AUTORIZADO', tipo: 'FACTURA', concepto: 'PRODUCTOS' });
      expect(f.fechaVencimiento.toISOString().slice(0, 10)).toBe('2026-12-06');
      expect(f.renglones.map((r) => r.remitoRenglonId)).toEqual([r1.renglones[0].id]);
      expect((await prisma.remitoRenglon.findUniqueOrThrow({ where: { id: r1.renglones[0].id } })).cantidadFacturada.toString()).toBe('10');
      const otra = await x.generar([x.clienteRI.id]);
      expect([otra.status, otra.body.message]).toEqual([400, 'No hay remitos pendientes de facturar']);
      expect(await prisma.comprobanteVenta.count()).toBe(2);
      // Consulta
      const lista = (await x.http.get('/api/ventas/facturacion-lotes')).body as Lote[];
      expect(lista.map((l) => [l.numero, l.estado, l.emitidas])).toEqual([[1, 'TERMINADO', 2]]);
      expect(((await x.http.get(`/api/ventas/facturacion-lotes/${lote.id}`)).body as Lote).items).toHaveLength(2);
      const pdf = await x.pdfTexto(`/api/ventas/facturacion-lotes/${lote.id}/pdf`);
      expect(pdf.tipo).toContain('application/pdf');
      const texto = pdf.texto + [...pdf.texto.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
      expect(texto.match(/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
      for (const i of lote.items) expect(texto).toContain(i.factura!.slice(-8));
    });

    it('cliente con problemas: omitido; ARCA rechaza: queda sin CAE con la factura guardada', async () => {
      const x = await escenario();
      const sinPrecio = await x.articulo(false);
      expect((await x.remito([{ articuloId: sinPrecio.id, descripcion: 'Cable', cantidad: 1 }], { terceroId: x.otro.id })).status).toBe(201);
      await x.pedidoYRemito(x.clienteRI.id, 10);
      ArcaSimulado.forzarFalla(x.empresaId, 'RECHAZO');
      const lote = (await x.generar([x.clienteRI.id, x.otro.id])).body as Lote;
      expect(lote).toMatchObject({ estado: 'TERMINADO', emitidas: 0, sinCae: 1, omitidas: 1 });
      expect(lote.items.map((i) => [i.razonSocial, i.resultado, i.mensaje])).toEqual([
        ['Almacén Sur SRL', 'OMITIDO', 'Sin precio: Cable (remito R 0001-00000001)'],
        ['Distribuidora Norte SA', 'SIN_CAE', 'ARCA rechazó el comprobante: (10015) Rechazo simulado para pruebas'],
      ]);
      expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: lote.items[1].comprobanteId! } })).toMatchObject({ estado: 'RECHAZADO' });
      // La factura guardada aparece como aviso en el próximo lote
      ArcaSimulado.forzarFalla(x.empresaId, null);
      expect((await x.vista(`&terceroIds=${x.clienteRI.id}`))[0].avisos).toEqual(['Ya está en la factura borrador sin autorizar']);
    });

    it('cliente obligado a factura de crédito MiPyME: el lote la emite como FCE', async () => {
      const x = await escenario();
      const banco = (await x.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
      const cuenta = (await x.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await x.cuenta('1.1.01.002'), cbu: '2850590940090418135201' })).body as { id: string };
      expect((await x.http.put('/api/arca/config', { ambiente: 'SIMULADO', mipyme: true, cuentaBancariaFceId: cuenta.id, transferenciaFce: 'SCA' })).status).toBe(200);
      ArcaSimuladoFce.obligar(x.empresaId, '20172543597', '1.00');
      await x.pedidoYRemito(x.clienteRI.id, 10);
      await x.pedidoYRemito(x.otro.id, 1);
      const lote = (await x.generar([x.clienteRI.id, x.otro.id])).body as Lote;
      expect(lote.items.map((i) => [i.razonSocial, i.resultado, i.fce])).toEqual([['Almacén Sur SRL', 'EMITIDA', false], ['Distribuidora Norte SA', 'EMITIDA', true]]);
      expect(await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: lote.items[1].comprobanteId! } })).toMatchObject({ fce: true, transferenciaFce: 'SCA', estado: 'AUTORIZADO' });
      ArcaSimuladoFce.limpiar(x.empresaId);
    });

    it('un lote a la vez; el cortado hace más de 15 minutos queda interrumpido; tope de facturas', async () => {
      const x = await escenario();
      await x.pedidoYRemito(x.clienteRI.id, 10);
      await x.pedidoYRemito(x.otro.id, 1);
      const enCurso = await prisma.loteFacturacion.create({ data: { empresaId: x.empresaId, numero: 1, fecha: new Date('2026-11-06'), hasta: new Date('2026-11-30'), puntoVentaId: x.puntoVenta.id, usuarioId: 'x' } });
      const b = await x.generar([x.clienteRI.id]);
      expect([b.status, b.body.message]).toEqual([409, 'Ya hay un lote de facturación en curso']);
      await prisma.loteFacturacion.update({ where: { id: enCurso.id }, data: { creadoEn: new Date(Date.now() - 20 * 60 * 1000) } });
      LotesFacturacionService.tope = 1;
      const t = await x.generar([x.clienteRI.id, x.otro.id]);
      expect([t.status, t.body.message]).toEqual([400, 'El lote supera las 1 facturas: acote los clientes o la fecha']);
      expect((await prisma.loteFacturacion.findUniqueOrThrow({ where: { id: enCurso.id } })).estado).toBe('INTERRUMPIDO');
      LotesFacturacionService.tope = 200;
      const ok = await x.generar([x.clienteRI.id]);
      expect([ok.status, ok.body.numero, ok.body.estado]).toEqual([201, 2, 'TERMINADO']);
    });
  });
});
