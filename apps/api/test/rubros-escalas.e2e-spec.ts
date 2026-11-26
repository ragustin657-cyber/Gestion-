import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('rubros de artículos y descuentos por cantidad (E56)', () => {
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
    const rubro = async (nombre: string) => {
      const r = await v.http.post('/api/rubros-articulos', { nombre });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const articulo = async (codigo: string, o: Record<string, unknown> = {}) => {
      const r = await v.http.post('/api/articulos', { codigo, descripcion: `Artículo ${codigo}`, alicuotaIva: 21, ...o });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; rubroId: string | null };
    };
    const sugerida = async (articuloId: string, cantidad: number) => (await v.http.get(`/api/ventas/bonificacion?articuloId=${articuloId}&cantidad=${cantidad}`)).body as { bonificacionPct: string | null; origen: string | null; desde: string | null };
    return { ...v, rubro, articulo, sugerida };
  };

  it('rubros: alta, nombre único, asignación y filtro; inactivo no se asigna', async () => {
    const x = await escenario();
    const b = await x.rubro('Bebidas');
    const dup = await x.http.post('/api/rubros-articulos', { nombre: 'Bebidas' });
    expect([dup.status, dup.body.message]).toEqual([409, 'Ya existe un rubro con ese nombre']);
    const a = await x.articulo('AGUA', { rubroId: b.id });
    expect(a.rubroId).toBe(b.id);
    await x.articulo('PAN');
    const lista = (await x.http.get(`/api/articulos?rubroId=${b.id}`)).body as { items: { codigo: string; rubro: string | null }[] };
    expect(lista.items.map((i) => [i.codigo, i.rubro])).toEqual([['AGUA', 'Bebidas']]);
    expect((await x.http.patch(`/api/rubros-articulos/${b.id}`, { activo: false })).status).toBe(200);
    const otro = await x.http.post('/api/articulos', { codigo: 'JUGO', descripcion: 'Jugo', alicuotaIva: 21, rubroId: b.id });
    expect([otro.status, otro.body.message]).toEqual([400, 'Rubro inexistente o inactivo']);
    expect((await x.http.patch(`/api/articulos/${a.id}`, { descripcion: 'Agua mineral', rubroId: b.id })).status).toBe(200);
    expect(((await x.http.get('/api/rubros-articulos?activos=1')).body as unknown[]).length).toBe(0);
  });

  it('escalas: rubro y artículo; la del artículo reemplaza; validaciones', async () => {
    const x = await escenario();
    const b = await x.rubro('Bebidas');
    const a = await x.articulo('AGUA', { rubroId: b.id });
    const sin = await x.articulo('PAN');
    expect((await x.http.put(`/api/rubros-articulos/${b.id}/escalas`, { escalas: [{ desde: 48, porcentaje: 10 }, { desde: 12, porcentaje: 5 }] })).status).toBe(200);
    expect((await x.http.get(`/api/rubros-articulos/${b.id}/escalas`)).body).toEqual([{ desde: '12', porcentaje: '5' }, { desde: '48', porcentaje: '10' }]);
    const rep = await x.http.put(`/api/rubros-articulos/${b.id}/escalas`, { escalas: [{ desde: 12, porcentaje: 5 }, { desde: 12, porcentaje: 6 }] });
    expect([rep.status, rep.body.message]).toEqual([400, 'Hay dos escalas con la misma cantidad']);
    expect((await x.http.put(`/api/rubros-articulos/${b.id}/escalas`, { escalas: [{ desde: 1, porcentaje: 101 }] })).status).toBe(400);
    expect(await x.sugerida(a.id, 6)).toEqual({ bonificacionPct: null, origen: null, desde: null });
    expect(await x.sugerida(a.id, 12)).toEqual({ bonificacionPct: '5', origen: 'RUBRO', desde: '12' });
    expect((await x.sugerida(a.id, 100)).bonificacionPct).toBe('10');
    expect((await x.sugerida(sin.id, 100)).bonificacionPct).toBeNull();
    expect((await x.http.put(`/api/articulos/${a.id}/escalas`, { escalas: [{ desde: 100, porcentaje: 3 }] })).status).toBe(200);
    expect((await x.sugerida(a.id, 50)).bonificacionPct).toBeNull();
    expect(await x.sugerida(a.id, 100)).toEqual({ bonificacionPct: '3', origen: 'ARTICULO', desde: '100' });
    expect((await x.http.put(`/api/articulos/${a.id}/escalas`, { escalas: [] })).status).toBe(200);
    expect((await x.sugerida(a.id, 50)).origen).toBe('RUBRO');
    await x.http.patch(`/api/rubros-articulos/${b.id}`, { activo: false });
    expect((await x.sugerida(a.id, 50)).bonificacionPct).toBeNull();
  });
});
