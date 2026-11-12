import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { escenarioInformes } from './helpers-informes';

type Fila = { clave: string; nombre: string; ventas: string; costo: string; margen: string; margenPct: string | null; sinCosto: string };

describe('informes: ventas y márgenes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const nov = 'desde=2026-11-01&hasta=2026-11-30';

  it('reproduce el ejemplo del spec por cliente y por artículo', async () => {
    const e = await escenarioInformes(app, prisma);
    const c = (await e.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).body;
    const fila = (filas: Fila[], clave: string) => filas.find((f) => f.clave === clave)!;
    expect(fila(c.filas, e.clienteRI.id)).toMatchObject({ ventas: '560.00', costo: '280.00', margen: '280.00', sinCosto: '0.00' });
    expect(fila(c.filas, e.y.id)).toMatchObject({ ventas: '500.00', costo: '50.00', sinCosto: '300.00' });
    expect(c.totales).toMatchObject({ ventas: '1060.00', costo: '330.00', margen: '430.00', margenPct: '56.58', sinCosto: '300.00' });
    const a = (await e.http.get(`/api/informes/ventas?${nov}&agrupar=articulo`)).body;
    expect(fila(a.filas, e.a.id)).toMatchObject({ ventas: '760.00', costo: '330.00', margen: '430.00', margenPct: '56.58' });
    expect(fila(a.filas, e.s.id)).toMatchObject({ ventas: '300.00', sinCosto: '300.00', margenPct: null });
    const m = (await e.http.get(`/api/informes/margenes?${nov}&agrupar=articulo`)).body;
    expect(m.totales).toMatchObject({ cobertura: '71.70', margenPct: '56.58' });
    expect(m.filas.map((f: Fila) => f.clave)).toEqual([e.a.id]);
  });

  it('coincide con el Mayor', async () => {
    const e = await escenarioInformes(app, prisma);
    const saldo = async (codigo: string) => (await prisma.asientoRenglon.findMany({ where: { empresaId: e.empresaId, cuentaContableId: await e.cuenta(codigo) } })).reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0).toFixed(2);
    expect(await saldo('4.1.01')).toBe('-1060.00');
    expect(await saldo('5.1.01')).toBe('330.00');
  });

  it('no cuenta borradores ni rechazados', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [e.ren(e.a.id, 1, 999)] }));
    const r = (await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [e.ren(e.a.id, 1, 888)] }))).body;
    await prisma.comprobanteVenta.update({ where: { id: r.id }, data: { estado: 'RECHAZADO' } });
    expect((await e.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).body.totales.ventas).toBe('1060.00');
  });

  it('remito facturado en dos partes', async () => {
    const e = await escenarioInformes(app, prisma);
    const rem = (await e.remito([{ articuloId: e.a.id, descripcion: 'x', cantidad: 20 }])).body;
    for (const q of [12, 8]) await e.emitir({ renglones: [e.ren(e.a.id, q, 20, { origen: 'REMITO', remitoRenglonId: rem.renglones[0].id })] });
    expect((await e.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).body.totales.costo).toBe('530.00');
  });

  it('agrupa por mes y reexpresa', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.emitir({ fecha: '2026-10-15', fechaVencimiento: '2026-11-15', renglones: [e.ren(e.s.id, 1, 1000)] });
    const q = 'desde=2026-10-01&hasta=2026-11-30&agrupar=mes&reexpresar=true';
    const sin = (await e.http.get(`/api/informes/ventas?${q}`)).body;
    expect(sin.aviso).toBe('Faltan los índices de: 10/2026, 11/2026: se muestran importes nominales');
    expect(sin.filas.find((f: Fila) => f.clave === '2026-10').ventas).toBe('1000.00');
    for (const [anio, mes, valor] of [[2026, 10, 100], [2026, 11, 110]]) await prisma.indiceInflacion.create({ data: { anio, mes, valor, actualizadoPor: 't' } });
    const con = (await e.http.get(`/api/informes/ventas?${q}`)).body;
    expect(con.aviso).toBeUndefined();
    expect(con.filas.map((f: Fila) => [f.clave, f.ventas])).toEqual([['2026-10', '1100.00'], ['2026-11', '1060.00']]);
  });

  it('valida fechas y permisos', async () => {
    const e = await escenarioInformes(app, prisma);
    expect((await e.http.get('/api/informes/ventas?hasta=2026-11-30&agrupar=cliente')).status).toBe(400);
    expect((await e.http.get('/api/informes/ventas?desde=2026-11-30&hasta=2026-11-01&agrupar=cliente')).body.message).toBe('La fecha desde no puede ser posterior a la fecha hasta');
    expect((await e.http.get('/api/informes/ventas?desde=2022-01-01&hasta=2026-11-30&agrupar=cliente')).body.message).toBe('El período no puede superar los 3 años');
    const u = await otroUsuario(app, prisma, e.empresaId, ['venta.ver']);
    expect((await u.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).status).toBe(403);
  });

  it('exporta', async () => {
    const e = await escenarioInformes(app, prisma);
    const bin = (url: string) => e.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((await bin(`/api/informes/ventas?${nov}&agrupar=cliente&formato=xlsx`)).headers['content-type']).toContain('spreadsheetml');
    expect((await bin(`/api/informes/margenes?${nov}&agrupar=articulo&formato=pdf`)).headers['content-type']).toContain('pdf');
  });
});
