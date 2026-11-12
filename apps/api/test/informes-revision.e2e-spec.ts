import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioInformes } from './helpers-informes';

type Fila = { clave: string; ventas: string; costo: string; margen: string; sinCosto: string };

describe('informes: correcciones de la revisión', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const nov = 'desde=2026-11-01&hasta=2026-11-30';

  it('el tablero del mes en curso corta en hoy: no cuenta como vencido lo que vence después de hoy', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.emitir({ fecha: '2026-11-04', fechaVencimiento: '2026-11-10', renglones: [e.ren(e.s.id, 1, 100)] });
    await e.emitir({ fecha: '2026-10-30', fechaVencimiento: '2026-11-01', renglones: [e.ren(e.s.id, 1, 200)] });
    const r = (await e.http.get(`/api/informes/tablero?${nov}`)).body;
    expect(r.indicadores.cobranzasVencidas.valor).toBe('242.00');
    // hoy es 06/11: el anterior es del 26/10 al 31/10 (misma cantidad de días)
    expect(r.indicadores.ventas.anterior).toBe('200.00');
  });

  it('NC sin devolución de un artículo con stock resta de las ventas con costo', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: (await e.emitir({ renglones: [e.ren(e.a.id, 1, 20)] })).id, renglones: [e.ren(e.a.id, 1, 20)] });
    const t = (await e.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).body.totales;
    expect(t).toMatchObject({ ventas: '1060.00', sinCosto: '300.00', costo: '340.00', margen: '420.00' });
  });

  it('márgenes muestra solo ventas con costo en filas y totales', async () => {
    const e = await escenarioInformes(app, prisma);
    const m = (await e.http.get(`/api/informes/margenes?${nov}&agrupar=cliente`)).body;
    expect(m.filas.find((f: Fila) => f.clave === e.y.id)).toMatchObject({ ventas: '200.00', costo: '50.00', margen: '150.00' });
    expect(m.totales).toMatchObject({ ventas: '760.00', costo: '330.00', margen: '430.00', cobertura: '71.70' });
  });

  it('con stock negativo regularizado, el costo coincide con el Mayor', async () => {
    const e = await escenarioInformes(app, prisma);
    await e.modo('AVISAR');
    const b = await e.articulo();
    await e.inicial(b.id, 2, 10, { fecha: '2026-11-02' });
    const f = await e.emitir({ renglones: [e.ren(b.id, 5, 30)] });
    await e.inicial(b.id, 1, 13, { fecha: '2026-11-03' });
    await e.emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.id, devuelveMercaderia: true, renglones: [e.ren(b.id, 4, 30)] });
    expect(await prisma.movimientoStock.count({ where: { articuloId: b.id, tipo: 'REGULARIZACION', origenTipo: 'VENTA' } })).toBeGreaterThan(0);
    const saldo = (await prisma.asientoRenglon.findMany({ where: { empresaId: e.empresaId, cuentaContableId: await e.cuenta('5.1.01') } })).reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0).toFixed(2);
    expect((await e.http.get(`/api/informes/ventas?${nov}&agrupar=cliente`)).body.totales.costo).toBe(saldo);
  });
});
