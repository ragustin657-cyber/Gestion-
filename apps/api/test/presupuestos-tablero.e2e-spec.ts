import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';

describe('presupuestos: tarjeta del tablero', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    await p.linea(a.id, '4.1.01', { '2026-11': 1000000 });
    await p.linea(a.id, '5.2.01', { '2026-11': 200000 });
    await p.linea(a.id, '5.2.01', { '2026-11': 100000 }, 'ROS');
    await p.asiento('2026-11-05', [['1.1.01.002', 900000, 0], ['4.1.01', 0, 900000]]);
    await p.asiento('2026-11-05', [['5.2.01', 220000, 0], ['5.2.01', 120000, 0, 'ROS'], ['5.2.01', 15000, 0, 'COR'], ['1.1.01.002', 0, 355000]]);
    return { ...p, a };
  };
  const tablero = async (http: { get: (u: string) => Promise<{ body: { indicadores: { presupuesto: unknown } } }> }, q = 'desde=2026-11-01&hasta=2026-11-30') => (await http.get(`/api/informes/tablero?${q}`)).body.indicadores.presupuesto;

  it('tarjeta con el vigente', async () => {
    const e = await escenario();
    await e.http.post(`/api/presupuestos/${e.a.id}/vigente`);
    expect(await tablero(e.http)).toEqual({ nombre: 'Original 2026', resultadoPresupuestado: '700000.00', resultadoReal: '545000.00', desvioPct: '-22.14' });
  });

  it('sin vigente, sin permiso o fuera del ejercicio', async () => {
    const e = await escenario();
    expect(await tablero(e.http)).toBeNull();
    await e.http.post(`/api/presupuestos/${e.a.id}/vigente`);
    const u = await otroUsuario(app, prisma, e.empresaId, ['informes.ver']);
    expect(await tablero(u.http)).toBeNull();
    expect(await tablero(e.http, 'desde=2027-01-01&hasta=2027-01-31')).toBeNull();
  });
});
