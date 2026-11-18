import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

export const TABLA_PRUEBA = {
  gni: 1200000, deduccionEspecial: 4800000, conyuge: 1200000, hijo: 600000, hijoIncapacitado: 1200000,
  topes: { hipotecario: 120000, seguroMuerte: 60000, seguroMixto: 60000, seguroRetiro: 60000, sepelio: 12000 },
  tramos: [{ desde: 0, hasta: 1200000, fijo: 0, porcentaje: 5 }, { desde: 1200000, hasta: 2400000, fijo: 60000, porcentaje: 10 }, { desde: 2400000, hasta: null, fijo: 180000, porcentaje: 15 }],
};

describe('ganancias: tablas de ARCA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('guardar y leer', async () => {
    const s = await prepararSueldos(app, prisma);
    const r = await s.http.put('/api/sueldos/ganancias/tablas/2026/2', TABLA_PRUEBA);
    expect(r.status).toBe(200);
    const g = (await s.http.get('/api/sueldos/ganancias/tablas/2026/2')).body;
    expect([g.gni, g.deduccionEspecial, g.topes.sepelio]).toEqual(['1200000.00', '4800000.00', '12000.00']);
    expect(g.tramos.map((t: { desde: string; hasta: string | null; porcentaje: string }) => [t.desde, t.hasta, t.porcentaje])).toEqual([['0.00', '1200000.00', '5.0000'], ['1200000.00', '2400000.00', '10.0000'], ['2400000.00', null, '15.0000']]);
    const vacia = await s.http.get('/api/sueldos/ganancias/tablas/2026/1');
    expect([vacia.status, vacia.text]).toEqual([200, '']);
  });

  it('tramos inválidos', async () => {
    const s = await prepararSueldos(app, prisma);
    const put = (tramos: unknown[]) => s.http.put('/api/sueldos/ganancias/tablas/2026/2', { ...TABLA_PRUEBA, tramos });
    const t = TABLA_PRUEBA.tramos;
    expect((await put([{ ...t[0], desde: 500 }, t[1], t[2]])).body.message).toBe('El primer tramo empieza en 0');
    expect((await put([t[0], { ...t[1], desde: 1300000 }, t[2]])).body.message).toBe('Los tramos deben ser consecutivos');
    expect((await put([t[0], t[1], { ...t[2], hasta: 9000000 }])).body.message).toBe('El último tramo no tiene límite');
  });

  it('copiar del semestre anterior', async () => {
    const s = await prepararSueldos(app, prisma);
    const sin = await s.http.post('/api/sueldos/ganancias/tablas/2026/2/copiar-anterior');
    expect([sin.status, sin.body.message]).toEqual([400, 'No hay tabla del semestre anterior']);
    await s.http.put('/api/sueldos/ganancias/tablas/2026/1', TABLA_PRUEBA);
    expect((await s.http.post('/api/sueldos/ganancias/tablas/2026/2/copiar-anterior')).status).toBe(201);
    const g = (await s.http.get('/api/sueldos/ganancias/tablas/2026/2')).body;
    expect([g.gni, g.tramos.length]).toEqual(['1200000.00', 3]);
    // Del 1.er semestre copia el 2.º del año anterior
    await s.http.put('/api/sueldos/ganancias/tablas/2026/2', { ...TABLA_PRUEBA, gni: 1500000 });
    await s.http.post('/api/sueldos/ganancias/tablas/2027/1/copiar-anterior');
    expect((await s.http.get('/api/sueldos/ganancias/tablas/2027/1')).body.gni).toBe('1500000.00');
  });

  it('precarga del concepto 560', async () => {
    const s = await prepararSueldos(app, prisma);
    const c = await prisma.concepto.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo: '560' } });
    const cuenta = await prisma.cuentaContable.findUniqueOrThrow({ where: { id: c.cuentaContableId! } });
    expect([c.tipo, c.clase, c.codigoArca, c.destino, cuenta.codigo]).toEqual(['GANANCIAS', 'DESCUENTO', '810008', 'OTRO', '2.1.02.002']);
  });

  it('permisos', async () => {
    const s = await prepararSueldos(app, prisma);
    const u = await otroUsuario(app, prisma, s.empresaId, ['sueldos.ver', 'sueldos.liquidar']);
    expect((await u.http.put('/api/sueldos/ganancias/tablas/2026/2', TABLA_PRUEBA)).status).toBe(403);
    expect((await u.http.get('/api/sueldos/ganancias/tablas/2026/2')).status).toBe(200);
  });
});
