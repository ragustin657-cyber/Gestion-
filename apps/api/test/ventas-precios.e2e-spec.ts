import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('ventas: listas de precios', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario() {
    const v = await prepararVentas(app, prisma);
    const art = async (codigo: string) => (await prisma.articulo.create({ data: { empresaId: v.empresaId, codigo, descripcion: `Artículo ${codigo}`, alicuotaIva: 21 } })).id;
    const a1 = await art('ART-1');
    const a2 = await art('ART-2');
    const lista = async (d: Record<string, unknown>) => {
      const r = await v.http.post('/api/ventas/listas', { monedaCodigo: 'ARS', ...d });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const precio = (listaId: string, articuloId: string, p: number) => v.http.put(`/api/ventas/listas/${listaId}/precios/${articuloId}`, { precio: p });
    const precios = async (listaId: string) => Object.fromEntries(((await v.http.get(`/api/ventas/listas/${listaId}/precios`)).body as { codigo: string; precio: string }[]).map((x) => [x.codigo, x.precio]));
    const importar = (listaId: string, contenido: Buffer, nombre = 'precios.csv') =>
      request(app.getHttpServer()).post(`/api/ventas/listas/${listaId}/importar`).set('Authorization', `Bearer ${v.token}`).attach('archivo', contenido, nombre);
    return { ...v, a1, a2, lista, precio, precios, importar };
  }

  it('una sola lista por defecto', async () => {
    const e = await escenario();
    const a = await e.lista({ nombre: 'A', porDefecto: true });
    await e.lista({ nombre: 'B', porDefecto: true });
    expect((await prisma.listaPrecios.findUniqueOrThrow({ where: { id: a.id } })).porDefecto).toBe(false);
    expect((await e.http.post('/api/ventas/listas', { nombre: 'A', monedaCodigo: 'ARS' })).status).toBe(409);
  });

  it('precio, baja e historial', async () => {
    const e = await escenario();
    const l = await e.lista({ nombre: 'Minorista' });
    expect((await e.precio(l.id, e.a1, 2500)).status).toBe(200);
    await e.precio(l.id, e.a1, 2600);
    expect((await e.http.delete(`/api/ventas/listas/${l.id}/precios/${e.a1}`)).status).toBe(200);
    const h = (await e.http.get(`/api/ventas/listas/${l.id}/historial?articuloId=${e.a1}`)).body as { motivo: string; precioAnterior: string | null; precioNuevo: string | null }[];
    expect(h.map((x) => [x.motivo, x.precioAnterior, x.precioNuevo])).toEqual([['MANUAL', null, '2500'], ['MANUAL', '2500', '2600'], ['BAJA', '2600', null]]);
    expect((await e.precio(l.id, e.a1, 0)).status).toBe(400);
  });

  it('aumento masivo', async () => {
    const e = await escenario();
    const l = await e.lista({ nombre: 'Minorista' });
    await e.precio(l.id, e.a1, 2500);
    await e.precio(l.id, e.a2, 1000);
    const r = await e.http.post(`/api/ventas/listas/${l.id}/aumento`, { porcentaje: 7.3, redondeo: '10' });
    expect(r.body).toEqual({ actualizados: 2 });
    expect(await e.precios(l.id)).toEqual({ 'ART-1': '2680', 'ART-2': '1070' });
    expect(await prisma.historialPrecio.count({ where: { listaId: l.id, motivo: 'AUMENTO' } })).toBe(2);
    const vacio = await e.http.post(`/api/ventas/listas/${l.id}/aumento`, { porcentaje: 5, redondeo: '1', articuloIds: [] });
    expect(vacio.status).toBe(400);
    expect(vacio.body.message).toBe('Elija al menos un artículo');
    expect((await e.http.post(`/api/ventas/listas/${l.id}/aumento`, { porcentaje: 0, redondeo: '1' })).status).toBe(400);
    const uno = await e.http.post(`/api/ventas/listas/${l.id}/aumento`, { porcentaje: 10, redondeo: '1', articuloIds: [e.a2] });
    expect(uno.body).toEqual({ actualizados: 1 });
    expect(await e.precios(l.id)).toEqual({ 'ART-1': '2680', 'ART-2': '1177' });
  });

  it('importa todo o nada', async () => {
    const e = await escenario();
    const l = await e.lista({ nombre: 'Minorista' });
    const r = await e.importar(l.id, Buffer.from('Código;Precio\nART-1;1.234,50\nART-2;99\n'));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ creados: 2, actualizados: 0 });
    expect(await e.precios(l.id)).toEqual({ 'ART-1': '1234.5', 'ART-2': '99' });
    const mal = await e.importar(l.id, Buffer.from('ART-1;10\nXX;5\n'));
    expect(mal.status).toBe(400);
    expect(mal.body.message).toBe('Línea 2: artículo inexistente');
    expect((await e.importar(l.id, Buffer.from('ART-1;0\n'))).body.message).toBe('Línea 1: precio inválido');
    expect((await e.importar(l.id, Buffer.from('ART-1;1\nART-1;2\n'))).body.message).toBe('Línea 2: artículo repetido');
    expect(await e.precios(l.id)).toEqual({ 'ART-1': '1234.5', 'ART-2': '99' });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Precios');
    ws.addRow(['Código', 'Precio']);
    ws.addRow(['ART-1', 1300]);
    ws.addRow(['ART-2', 120.5]);
    const x = await e.importar(l.id, Buffer.from(await wb.xlsx.writeBuffer()), 'precios.xlsx');
    expect(x.body).toEqual({ creados: 0, actualizados: 2 });
    expect(await e.precios(l.id)).toEqual({ 'ART-1': '1300', 'ART-2': '120.5' });
  });

  it('precio sugerido', async () => {
    const e = await escenario();
    const porDefecto = await e.lista({ nombre: 'Minorista', porDefecto: true });
    const usd = await e.lista({ nombre: 'Exportación', monedaCodigo: 'USD' });
    await e.precio(porDefecto.id, e.a1, 2500);
    await e.precio(usd.id, e.a1, 2);
    const sug = async (q: string) => (await e.http.get(`/api/ventas/precio?terceroId=${e.clienteRI.id}&articuloId=${e.a1}&${q}`)).body;
    expect(await sug('monedaCodigo=ARS')).toEqual({ precio: '2500.00', lista: { id: porDefecto.id, nombre: 'Minorista' } });
    expect((await sug('monedaCodigo=USD&cotizacion=1250')).precio).toBe('2.00');
    await e.http.patch(`/api/terceros/${e.clienteRI.id}`, { listaPreciosId: usd.id });
    expect(await sug('monedaCodigo=ARS&cotizacion=1000')).toEqual({ precio: '2000.00', lista: { id: usd.id, nombre: 'Exportación' } });
    const sinPrecio = (await e.http.get(`/api/ventas/precio?terceroId=${e.clienteRI.id}&articuloId=${e.a2}&monedaCodigo=USD`)).body;
    expect(sinPrecio.precio).toBeNull();
  });

  it('no cambia la moneda con precios', async () => {
    const e = await escenario();
    const l = await e.lista({ nombre: 'Minorista' });
    await e.precio(l.id, e.a1, 10);
    const r = await e.http.patch(`/api/ventas/listas/${l.id}`, { monedaCodigo: 'USD' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La lista tiene precios: no se puede cambiar la moneda');
  });

  it('permisos', async () => {
    const e = await escenario();
    const l = await e.lista({ nombre: 'Minorista' });
    const lector = await otroUsuario(app, prisma, e.empresaId, ['venta.ver']);
    expect((await lector.http.get(`/api/ventas/listas/${l.id}/precios`)).status).toBe(200);
    expect((await lector.http.put(`/api/ventas/listas/${l.id}/precios/${e.a1}`, { precio: 1 })).status).toBe(403);
  });
});
