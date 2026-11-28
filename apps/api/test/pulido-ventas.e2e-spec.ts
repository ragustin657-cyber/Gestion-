import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { horaArgentina } from '../src/ventas/remitos/cot/traslado';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

describe('pulido de ventas (E59)', () => {
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
    const entrega = async (cantidad = 10) => {
      const r = await e.remito([{ articuloId: art.id, descripcion: 'Producto', cantidad }]);
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; renglones: { id: string }[] };
    };
    const devolver = (remitoRenglonOrigenId: string, cantidad: number) =>
      e.http.post('/api/ventas/remitos/devoluciones', { terceroId: e.clienteRI.id, puntoVentaId: e.puntoVenta.id, fecha: '2026-11-04', renglones: [{ remitoRenglonOrigenId, cantidad }] });
    const facturar = (remitoRenglonId: string, cantidad: number, emitir = true) =>
      e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones: [{ origen: 'REMITO', remitoRenglonId, descripcion: 'x', cantidad, precioUnitario: 1000, alicuota: 21 }] }), emitir });
    return { ...e, art, entrega, devolver, facturar };
  };

  it('1. el remito de entrega muestra sus devoluciones', async () => {
    const x = await escenario();
    const r = await x.entrega();
    expect((await x.http.get(`/api/ventas/remitos/${r.id}`)).body.devoluciones).toEqual([]);
    const d = await x.devolver(r.renglones[0].id, 2);
    const det = (await x.http.get(`/api/ventas/remitos/${r.id}`)).body;
    expect(det.devoluciones.map((y: { numeroTexto: string }) => y.numeroTexto)).toEqual([d.body.numeroTexto]);
    expect(det.devoluciones[0].renglones).toEqual([{ remitoRenglonOrigenId: r.renglones[0].id, cantidad: '2' }]);
  });

  it('2. pendientes a acreditar: una fila por factura', async () => {
    const x = await escenario();
    const r = await x.entrega();
    const f1 = await x.facturar(r.renglones[0].id, 6);
    const f2 = await x.facturar(r.renglones[0].id, 4);
    await x.devolver(r.renglones[0].id, 8);
    const p = (await x.http.get(`/api/ventas/remitos/pendientes-acreditar?terceroId=${x.clienteRI.id}`)).body as { facturaId: string; pendiente: string }[];
    expect(p.map((y) => [y.facturaId, y.pendiente]).sort()).toEqual([[f1.body.id, '6'], [f2.body.id, '4']].sort());
  });

  it('3-4. lote: lista en USD con la cotización de la fecha de emisión; todo en borradores', async () => {
    const x = await escenario();
    const lista = (await x.http.post('/api/ventas/listas', { nombre: 'Dólar', monedaCodigo: 'USD', porDefecto: true })).body as { id: string };
    await x.http.put(`/api/ventas/listas/${lista.id}/precios/${x.art.id}`, { precio: 10 });
    const r = await x.entrega(1);
    let g = (await x.http.get('/api/ventas/facturacion-lotes/vista-previa?hasta=2026-11-30&fecha=2026-11-10')).body;
    expect(g[0].problemas).toContain('No hay cotización de USD para la fecha');
    await x.cotizacionUsd('2026-11-06', 1000);
    await x.cotizacionUsd('2026-11-10', 1200);
    g = (await x.http.get('/api/ventas/facturacion-lotes/vista-previa?hasta=2026-11-30&fecha=2026-11-10')).body;
    expect(g[0].renglones[0].precioUnitario).toBe('12000');
    expect((await x.facturar(r.renglones[0].id, 1, false)).status).toBe(201);
    const gen = await x.http.post('/api/ventas/facturacion-lotes', { hasta: '2026-11-30', fecha: '2026-11-10', puntoVentaId: x.puntoVenta.id, grupos: [{ terceroId: x.clienteRI.id, monedaCodigo: 'ARS' }] });
    expect([gen.status, gen.body.message]).toEqual([400, 'No hay remitos pendientes de facturar: los renglones están en facturas sin autorizar']);
  });

  it('5, 8. margen solo en listas desde el costo; rubro inválido', async () => {
    const x = await escenario();
    const base = (await x.http.post('/api/ventas/listas', { nombre: 'Base', monedaCodigo: 'ARS' })).body as { id: string };
    await x.http.put(`/api/ventas/listas/${base.id}/precios/${x.art.id}`, { precio: 100 });
    const der = (await x.http.post('/api/ventas/listas', { nombre: 'Derivada', monedaCodigo: 'ARS', base: 'LISTA', listaBaseId: base.id, porcentaje: 10, redondeo: '1' })).body as { id: string };
    const filas = (await x.http.get(`/api/ventas/listas/${der.id}/recalculo`)).body.filas as Record<string, unknown>[];
    expect(filas[0].origenMargen).toBeUndefined();
    const bad = await x.http.get('/api/articulos?rubroId=abc');
    expect([bad.status, bad.body.message]).toEqual([400, 'Rubro inválido']);
  });

  it('11, 13, 15. COT: provincia vacía propone el cliente; patente con espacios; hora 24 h; borrar la clave', async () => {
    const x = await escenario();
    await x.http.put('/api/ventas/cot/config', { activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: 'secreta' });
    await x.http.patch(`/api/terceros/${x.clienteRI.id}`, { entregaCalle: 'San Martín', entregaNumero: '50', entregaCodigoPostal: '1900', entregaLocalidad: 'La Plata', entregaProvincia: 'B' });
    const r = await x.remito([{ articuloId: x.art.id, descripcion: 'Producto', cantidad: 1 }], { traslado: { provincia: null, calle: '', patente: 'AB 123 CD' } });
    expect([r.status, r.body.trasladoCalle, r.body.patente]).toEqual([201, 'San Martín', 'AB123CD']);
    expect(horaArgentina(new Date('2026-11-06T03:30:00Z'))).toBe('0030');
    const t = await x.http.post('/api/transportistas', { cuit: '20-17254359-7', razonSocial: 'Fletes', patentePorDefecto: 'AA-111-AA' });
    expect(t.body.patentePorDefecto).toBe('AA111AA');
    expect((await x.http.put('/api/ventas/cot/config', { pedirAlConfirmar: true })).body.tieneClave).toBe(true);
    expect((await x.http.put('/api/ventas/cot/config', { clave: null })).body.tieneClave).toBe(false);
  });
});
