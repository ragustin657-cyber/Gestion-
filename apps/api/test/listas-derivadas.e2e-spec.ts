import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase } from './helpers';
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

  describe('recálculo', () => {
    type Prev = { filas: { articuloId: string; codigo: string; actual: string | null; nuevo: string | null; variacionPct: string | null; motivo: string | null }[] };
    let numero = 500;
    const conCompras = async () => {
      const x = await escenario();
      const { proveedorId } = await datosCompras(prisma, x.empresaId);
      const compra = async (o: { fecha?: string; tipo?: string; renglones: { articuloId: string; cantidad: number; precioUnitario: number; bonificacionPct?: number }[] }) => {
        const total = o.renglones.reduce((t, r) => t + r.cantidad * r.precioUnitario * (1 - (r.bonificacionPct ?? 0) / 100) * 1.21, 0);
        const r = await x.http.post('/api/compras/comprobantes', {
          terceroId: proveedorId, tipo: o.tipo ?? 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: o.fecha ?? '2026-11-02', fechaContable: o.fecha ?? '2026-11-02',
          monedaCodigo: 'ARS', totalDeclarado: Math.round(total * 100) / 100,
          renglones: o.renglones.map((y) => ({ origen: 'DIRECTO', descripcion: 'Compra', alicuotaIva: 21, ...y })),
        });
        if (r.status !== 201) throw new Error(JSON.stringify(r.body));
        return r.body as { id: string };
      };
      const previa = async (id: string) => { const r = await x.http.get(`/api/ventas/listas/${id}/recalculo`); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as Prev; };
      return { ...x, compra, previa };
    };

    it('desde el costo: última factura (promedio ponderado), costo promedio, sin costo, margen propio y fijos', async () => {
      const x = await conCompras();
      const a1 = await x.art('A1'), a2 = await x.art('A2', { costoPromedio: 500 }), a3 = await x.art('A3'), srv = await x.art('S1', { esServicio: true });
      await x.compra({ fecha: '2026-11-01', renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 1000 }] });
      const costo = await x.lista({ nombre: 'Costo', base: 'COSTO', porcentaje: 30, redondeo: '1' });
      let p = await x.previa(costo.id);
      const de = (id: string) => p.filas.find((f) => f.articuloId === id);
      expect([de(a1)!.actual, de(a1)!.nuevo, de(a1)!.motivo]).toEqual([null, '1300', null]);
      expect(de(a2)!.nuevo).toBe('650');
      // Revisión: sin costo y sin precio en la lista, no aparece
      expect(de(a3)).toBeUndefined();
      expect(de(srv)).toBeUndefined();
      // Factura posterior con dos renglones del artículo (1000 y 1200): costo 1100; una NC posterior no cuenta
      await x.compra({ fecha: '2026-11-03', renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 1000 }, { articuloId: a1, cantidad: 1, precioUnitario: 1200 }] });
      const nc = await x.compra({ fecha: '2026-11-04', renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 5000 }] });
      await prisma.comprobanteCompra.update({ where: { id: nc.id }, data: { tipo: 'NOTA_CREDITO' } });
      const anulada = await x.compra({ fecha: '2026-11-05', renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 7000 }] });
      await prisma.comprobanteCompra.update({ where: { id: anulada.id }, data: { estado: 'ANULADO' } });
      p = await x.previa(costo.id);
      expect(de(a1)!.nuevo).toBe('1430');
      // Aplicar todo
      const r = await x.http.post(`/api/ventas/listas/${costo.id}/recalculo`, {});
      expect([r.status, r.body.agregados, r.body.actualizados]).toEqual([201, 2, 0]);
      const h = (await x.http.get(`/api/ventas/listas/${costo.id}/historial?articuloId=${a1}`)).body as { motivo: string }[];
      expect(h.map((y) => y.motivo)).toEqual(['RECALCULO']);
      // Margen propio y fijo
      await x.http.patch(`/api/ventas/listas/${costo.id}/precios/${a1}/marcas`, { margenPct: 50 });
      await x.precio(costo.id, a2, 999);
      p = await x.previa(costo.id);
      expect([de(a1)!.nuevo, de(a2)!.motivo]).toEqual(['1650', 'Precio fijo']);
      const r2 = await x.http.post(`/api/ventas/listas/${costo.id}/recalculo`, { articuloIds: [a1, a2] });
      expect([r2.status, r2.body.actualizados]).toEqual([201, 1]);
      const fs = await x.filas(costo.id);
      expect(fs.find((f) => f.articuloId === a2)!.precio).toBe('999');
      // Precios iguales: sin historial nuevo
      await x.http.post(`/api/ventas/listas/${costo.id}/recalculo`, {});
      expect(((await x.http.get(`/api/ventas/listas/${costo.id}/historial?articuloId=${a1}`)).body as unknown[]).length).toBe(2);
    });

    it('desde otra lista y aviso de dependientes; lista manual da error', async () => {
      const x = await conCompras();
      const a1 = await x.art('A1'), a2 = await x.art('A2');
      const min = await x.lista({ nombre: 'Minorista' });
      await x.precio(min.id, a1, 1000);
      const may = await x.lista({ nombre: 'Mayorista', base: 'LISTA', listaBaseId: min.id, porcentaje: -10, redondeo: '1' });
      await x.lista({ nombre: 'Distribuidor', base: 'LISTA', listaBaseId: may.id, porcentaje: -5, redondeo: '1' });
      const p = await x.previa(may.id);
      expect(p.filas.map((f) => [f.codigo, f.nuevo, f.motivo])).toEqual([['A1', '900', null]]);
      expect(a2).toBeDefined();
      const r = await x.http.post(`/api/ventas/listas/${may.id}/recalculo`, {});
      expect([r.status, r.body.agregados, r.body.aviso]).toEqual([201, 1, 'Las listas Distribuidor dependen de esta: recalcúlelas']);
      const m = await x.http.get(`/api/ventas/listas/${min.id}/recalculo`);
      expect([m.status, m.body.message]).toEqual([400, 'La lista se carga a mano']);
    });

    it('lista en dólares desde el costo en pesos; sin cotización, error', async () => {
      const x = await conCompras();
      const a1 = await x.art('A1');
      await x.compra({ renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 1000 }] });
      const usd = await x.lista({ nombre: 'Export', monedaCodigo: 'USD', base: 'COSTO', porcentaje: 30, redondeo: '0.01' });
      await prisma.cotizacion.deleteMany({ where: { monedaCodigo: 'USD' } });
      const sin = await x.http.get(`/api/ventas/listas/${usd.id}/recalculo`);
      expect(sin.status).toBe(400);
      await x.cotizacionUsd('2026-11-06', 1000);
      expect((await x.previa(usd.id)).filas.find((f) => f.articuloId === a1)!.nuevo).toBe('1.3');
    });

    it('revisión: sin filas en blanco; precio que ya no está en la base; costo cero; muchos artículos', async () => {
      const x = await conCompras();
      const a1 = await x.art('A1'), a2 = await x.art('A2'), a3 = await x.art('A3');
      // Costo cero (compra bonificada al 100 %) = sin costo
      const c0 = await x.compra({ renglones: [{ articuloId: a1, cantidad: 1, precioUnitario: 1000 }] });
      await prisma.comprobanteCompraRenglon.updateMany({ where: { comprobanteId: c0.id }, data: { importe: 0 } });
      const costo = await x.lista({ nombre: 'Costo', base: 'COSTO', porcentaje: 30, redondeo: '1' });
      let p = await x.previa(costo.id);
      expect(p.filas.every((f) => f.codigo)).toBe(true);
      expect(p.filas.find((f) => f.articuloId === a3)).toBeUndefined();
      // Costo cero = sin costo: sin precio en la lista no aparece (nunca un precio de un paso de redondeo)
      expect(p.filas.find((f) => f.articuloId === a1)).toBeUndefined();
      // Lista derivada con un precio que ya no está en la base
      const min = await x.lista({ nombre: 'Minorista' });
      await x.precio(min.id, a2, 1000);
      const may = await x.lista({ nombre: 'Mayorista', base: 'LISTA', listaBaseId: min.id, porcentaje: -10, redondeo: '1' });
      await x.http.post(`/api/ventas/listas/${may.id}/recalculo`, {});
      await prisma.precioLista.deleteMany({ where: { listaId: min.id, articuloId: a2 } });
      p = await x.previa(may.id);
      expect(p.filas.map((f) => [f.articuloId, f.motivo])).toEqual([[a2, 'Sin precio en la lista base']]);
    });

    it('revisión: aplicar sobre un catálogo grande no corta la transacción', async () => {
      const x = await conCompras();
      await prisma.articulo.createMany({ data: Array.from({ length: 1500 }, (_, i) => ({ empresaId: x.empresaId, codigo: `M${String(i).padStart(5, '0')}`, descripcion: `Masivo ${i}`, alicuotaIva: 21, costoPromedio: 100 + i })) });
      const costo = await x.lista({ nombre: 'Costo', base: 'COSTO', porcentaje: 30, redondeo: '1' });
      const r = await x.http.post(`/api/ventas/listas/${costo.id}/recalculo`, {});
      expect([r.status, r.body.agregados]).toEqual([201, 1500]);
    }, 120000);
  });
});

