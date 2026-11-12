import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';
import { escenarioInformes } from './helpers-informes';

type Mes = { mes: string; ventas: string; costo: string; margen: string };

describe('informes: tablero', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const nov = 'desde=2026-11-01&hasta=2026-11-30';

  it('indicadores del ejemplo', async () => {
    const e = await escenarioInformes(app, prisma);
    const r = (await e.http.get(`/api/informes/tablero?${nov}`)).body;
    expect(r.indicadores.ventas.valor).toBe('1060.00');
    expect(r.indicadores.margenPct.valor).toBe('56.58');
    expect(r.indicadores.stock.valor).toBe('670.00');
    expect(r.indicadores.cobranzasVencidas.valor).toBe('0.00');
    expect(r.ventasPorMes).toHaveLength(12);
    expect(r.ventasPorMes[0].mes).toBe('2025-12');
    expect(r.ventasPorMes[11]).toEqual({ mes: '2026-11', ventas: '1060.00', costo: '330.00', margen: '430.00' });
    expect(r.topClientes[0]).toMatchObject({ id: e.clienteRI.id, ventas: '560.00' });
    expect(r.topArticulos[0]).toMatchObject({ id: e.a.id, descripcion: `Artículo ${e.a.codigo}`, ventas: '760.00', margen: '430.00' });
  });

  it('comparaciones', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.emitir({ fecha: '2026-10-20', fechaVencimiento: '2026-10-25', renglones: [e.ren(e.s.id, 1, 500)] });
    const r = (await e.http.get(`/api/informes/tablero?${nov}`)).body;
    expect(r.indicadores.ventas).toEqual({ valor: '1060.00', anterior: '500.00', anioAnterior: '0.00' });
    expect(r.indicadores.margenPct).toEqual({ valor: '56.58', anterior: null, anioAnterior: null });
    expect(r.indicadores.cobranzasVencidas.valor).toBe('605.00');
    await e.emitir({ fecha: '2026-11-02', renglones: [e.ren(e.s.id, 1, 70)] });
    const dia = (await e.http.get('/api/informes/tablero?desde=2026-11-03&hasta=2026-11-03')).body;
    expect(dia.indicadores.ventas).toMatchObject({ valor: '1060.00', anterior: '70.00' });
  });

  it('empresa vacía', async () => {
    const s = await sesion(app, prisma, { permisos: ['informes.ver'] });
    const r = await s.http.get(`/api/informes/tablero?${nov}`);
    expect(r.status).toBe(200);
    const i = r.body.indicadores;
    expect([i.ventas.valor, i.ventas.anterior, i.cobranzasVencidas.valor, i.deudaVencida.valor, i.stock.valor]).toEqual(['0.00', '0.00', '0.00', '0.00', '0.00']);
    expect(i.margenPct.valor).toBeNull();
    expect(r.body.ventasPorMes.map((m: Mes) => m.ventas)).toEqual(Array(12).fill('0.00'));
    expect(r.body.topClientes).toEqual([]);
  });

  it('reexpresa la serie', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.emitir({ fecha: '2026-10-20', fechaVencimiento: '2026-11-20', renglones: [e.ren(e.s.id, 1, 1000)] });
    const q = `${nov}&reexpresar=true`;
    expect((await e.http.get(`/api/informes/tablero?${q}`)).body.aviso).toBe('Faltan los índices de: 10/2026, 11/2026: se muestran importes nominales');
    for (const [anio, mes, valor] of [[2026, 10, 100], [2026, 11, 110]]) await prisma.indiceInflacion.create({ data: { anio, mes, valor, actualizadoPor: 't' } });
    const r = (await e.http.get(`/api/informes/tablero?${q}`)).body;
    expect(r.aviso).toBeUndefined();
    expect(r.ventasPorMes.slice(-2).map((m: Mes) => m.ventas)).toEqual(['1100.00', '1060.00']);
    expect(r.indicadores.ventas.anterior).toBe('1100.00');
  });
});
