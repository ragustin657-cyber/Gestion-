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

  it('margen por rubro y lista en las listas desde el costo', async () => {
    const x = await escenario();
    const b = await x.rubro('Bebidas');
    const a = await x.articulo('AGUA', { rubroId: b.id });
    await prisma.articulo.update({ where: { id: a.id }, data: { costoPromedio: 1000 } });
    const lista = async (nombre: string, base: string, porcentaje: number) => (await x.http.post('/api/ventas/listas', { nombre, monedaCodigo: 'ARS', base, porcentaje, redondeo: '1' })).body as { id: string };
    const may = await lista('Mayorista', 'COSTO', 30);
    const min = await lista('Minorista', 'COSTO', 60);
    const man = await lista('Manual', 'MANUAL', 0);
    const fila = async (id: string) => ((await x.http.get(`/api/ventas/listas/${id}/recalculo`)).body.filas as { articuloId: string; nuevo: string; margen: string; origenMargen: string }[]).find((f) => f.articuloId === a.id)!;
    expect((await x.http.put(`/api/ventas/listas/${may.id}/margenes-rubro`, { margenes: [{ rubroId: b.id, margenPct: 20 }] })).status).toBe(200);
    expect((await x.http.get(`/api/ventas/listas/${may.id}/margenes-rubro`)).body).toEqual([{ rubroId: b.id, nombre: 'Bebidas', margenPct: '20' }]);
    expect(await fila(may.id)).toMatchObject({ nuevo: '1200', margen: '20', origenMargen: 'RUBRO' });
    expect(await fila(min.id)).toMatchObject({ nuevo: '1600', margen: '60', origenMargen: 'LISTA' });
    await x.http.put(`/api/ventas/listas/${may.id}/precios/${a.id}`, { precio: 1 });
    await x.http.patch(`/api/ventas/listas/${may.id}/precios/${a.id}/marcas`, { fijo: false, margenPct: 50 });
    expect(await fila(may.id)).toMatchObject({ nuevo: '1500', margen: '50', origenMargen: 'ARTICULO' });
    await x.http.patch(`/api/ventas/listas/${may.id}/precios/${a.id}/marcas`, { margenPct: null });
    await x.http.patch(`/api/rubros-articulos/${b.id}`, { activo: false });
    expect(await fila(may.id)).toMatchObject({ nuevo: '1300', origenMargen: 'LISTA' });
    const mal = await x.http.put(`/api/ventas/listas/${man.id}/margenes-rubro`, { margenes: [] });
    expect([mal.status, mal.body.message]).toEqual([400, 'La lista no se calcula desde el costo']);
    const inact = await x.http.put(`/api/ventas/listas/${may.id}/margenes-rubro`, { margenes: [{ rubroId: b.id, margenPct: 20 }] });
    expect([inact.status, inact.body.message]).toEqual([400, 'Rubro inexistente o inactivo']);
  });

  it('revisión final: guardar los márgenes no borra los de un rubro desactivado', async () => {
    const x = await escenario();
    const a = await x.rubro('Bebidas');
    const b = await x.rubro('Limpieza');
    const lista = (await x.http.post('/api/ventas/listas', { nombre: 'Mayorista', monedaCodigo: 'ARS', base: 'COSTO', porcentaje: 30, redondeo: '1' })).body as { id: string };
    expect((await x.http.put(`/api/ventas/listas/${lista.id}/margenes-rubro`, { margenes: [{ rubroId: a.id, margenPct: 40 }, { rubroId: b.id, margenPct: 20 }] })).status).toBe(200);
    await x.http.patch(`/api/rubros-articulos/${a.id}`, { activo: false });
    expect((await x.http.put(`/api/ventas/listas/${lista.id}/margenes-rubro`, { margenes: [{ rubroId: b.id, margenPct: 25 }] })).status).toBe(200);
    await x.http.patch(`/api/rubros-articulos/${a.id}`, { activo: true });
    expect((await x.http.get(`/api/ventas/listas/${lista.id}/margenes-rubro`)).body).toEqual([{ rubroId: a.id, nombre: 'Bebidas', margenPct: '40' }, { rubroId: b.id, nombre: 'Limpieza', margenPct: '25' }]);
  });
});
