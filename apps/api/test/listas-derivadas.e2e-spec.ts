import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

type Fila = { articuloId: string; codigo: string; precio: string; fijo: boolean; margenPct: string | null };

describe('listas de precios derivadas y desde el costo (E52)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const v = await prepararVentas(app, prisma);
    const art = async (codigo: string, o: Record<string, unknown> = {}) => (await prisma.articulo.create({ data: { empresaId: v.empresaId, codigo, descripcion: `Artículo ${codigo}`, alicuotaIva: 21, ...o } })).id;
    const lista = async (d: Record<string, unknown>) => {
      const r = await v.http.post('/api/ventas/listas', { monedaCodigo: 'ARS', ...d });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const precio = (listaId: string, articuloId: string, p: number) => v.http.put(`/api/ventas/listas/${listaId}/precios/${articuloId}`, { precio: p });
    const filas = async (listaId: string) => (await v.http.get(`/api/ventas/listas/${listaId}/precios`)).body as Fila[];
    return { ...v, art, lista, precio, filas };
  };

  describe('regla de la lista', () => {
    it('base otra lista: guarda la regla; validaciones y ciclos', async () => {
      const x = await escenario();
      const a = await x.lista({ nombre: 'Minorista' });
      const b = await x.lista({ nombre: 'Mayorista', base: 'LISTA', listaBaseId: a.id, porcentaje: -10, redondeo: '1' });
      const l = (await x.http.get('/api/ventas/listas')).body.find((y: { id: string }) => y.id === b.id);
      expect([l.base, l.listaBaseId, Number(l.porcentaje), l.redondeo]).toEqual(['LISTA', a.id, -10, '1']);
      let r = await x.http.post('/api/ventas/listas', { nombre: 'X', monedaCodigo: 'ARS', base: 'LISTA', listaBaseId: '00000000-0000-0000-0000-000000000000', porcentaje: 5, redondeo: '1' });
      expect(r.status).toBe(400);
      r = await x.http.patch(`/api/ventas/listas/${a.id}`, { base: 'LISTA', listaBaseId: b.id, porcentaje: 5, redondeo: '1' });
      expect([r.status, r.body.message]).toEqual([400, 'La lista base no puede depender de esta lista']);
      r = await x.http.patch(`/api/ventas/listas/${a.id}`, { base: 'LISTA', listaBaseId: a.id, porcentaje: 5, redondeo: '1' });
      expect([r.status, r.body.message]).toEqual([400, 'La lista base no puede depender de esta lista']);
      const c = await x.lista({ nombre: 'Distribuidor', base: 'LISTA', listaBaseId: b.id, porcentaje: -5, redondeo: '1' });
      r = await x.http.patch(`/api/ventas/listas/${a.id}`, { base: 'LISTA', listaBaseId: c.id, porcentaje: 5, redondeo: '1' });
      expect([r.status, r.body.message]).toEqual([400, 'La lista base no puede depender de esta lista']);
      r = await x.http.post('/api/ventas/listas', { nombre: 'Costo', monedaCodigo: 'ARS', base: 'COSTO', porcentaje: -5, redondeo: '1' });
      expect(r.status).toBe(400);
      r = await x.http.post('/api/ventas/listas', { nombre: 'Sin base', monedaCodigo: 'ARS', base: 'LISTA', porcentaje: 5, redondeo: '1' });
      expect(r.status).toBe(400);
    });

    it('precio fijo en listas calculadas; margen por artículo', async () => {
      const x = await escenario();
      const a1 = await x.art('A1');
      const manual = await x.lista({ nombre: 'Manual' });
      const costo = await x.lista({ nombre: 'Costo', base: 'COSTO', porcentaje: 30, redondeo: '1' });
      await x.precio(manual.id, a1, 100);
      await x.precio(costo.id, a1, 200);
      expect((await x.filas(manual.id))[0].fijo).toBe(false);
      expect((await x.filas(costo.id))[0].fijo).toBe(true);
      // Aumento masivo en una lista calculada: fijos
      const a2 = await x.art('A2');
      await prisma.precioLista.create({ data: { empresaId: x.empresaId, listaId: costo.id, articuloId: a2, precio: 50 } });
      await x.http.post(`/api/ventas/listas/${costo.id}/aumento`, { porcentaje: 10, redondeo: '1', articuloIds: [a2] });
      expect((await x.filas(costo.id)).find((f) => f.articuloId === a2)!.fijo).toBe(true);
      const m = await x.http.patch(`/api/ventas/listas/${costo.id}/precios/${a1}/marcas`, { fijo: false, margenPct: 40 });
      expect(m.status).toBe(200);
      const f = (await x.filas(costo.id)).find((y) => y.articuloId === a1)!;
      expect([f.fijo, Number(f.margenPct)]).toEqual([false, 40]);
      const a3 = await x.art('A3');
      const sin = await x.http.patch(`/api/ventas/listas/${costo.id}/precios/${a3}/marcas`, { margenPct: 40 });
      expect([sin.status, sin.body.message]).toEqual([404, 'El artículo no tiene precio en la lista']);
    });
  });
});
