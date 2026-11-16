import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: correcciones de la revisión (entrega 20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-10', 1000000);
    const e = await s.empleado();
    const mensual = async (mes: number) => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes, fechaPago: `2026-${mes}-28` })).body as { id: string };
    const baja = (fechaEgreso: string) => s.http.post('/api/sueldos/egresos', { empleadoId: e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso, preavisoOtorgado: false, fechaPago: fechaEgreso });
    return { ...s, e, mensual, baja };
  };

  it('egreso en octubre con noviembre reabierto: noviembre pierde el recibo numerado', async () => {
    const x = await escenario();
    const oct = await x.mensual(10);
    const nov = await x.mensual(11);
    await x.http.post(`/api/sueldos/liquidaciones/${oct.id}/cerrar`);
    await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/cerrar`);
    await x.http.post(`/api/sueldos/liquidaciones/${oct.id}/reabrir`);
    await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/reabrir`);
    expect((await x.baja('2026-10-15')).status).toBe(201);
    await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/recalcular`);
    expect(await prisma.reciboSueldo.count({ where: { liquidacionId: nov.id, empleadoId: x.e.id } })).toBe(0);
  });

  it('baja y cierre de la mensual al mismo tiempo no dejan una cerrada sin su recibo', async () => {
    const x = await escenario();
    const nov = await x.mensual(11);
    const [cierre, baja] = await Promise.all([x.http.post(`/api/sueldos/liquidaciones/${nov.id}/cerrar`), x.baja('2026-11-15')]);
    const l = await prisma.liquidacion.findUniqueOrThrow({ where: { id: nov.id } });
    const recibo = await prisma.reciboSueldo.count({ where: { liquidacionId: nov.id, empleadoId: x.e.id } });
    if (baja.status === 201) {
      // la baja ganó: la mensual se cerró sin el empleado (o no se pudo cerrar por no tener recibos)
      expect(recibo).toBe(0);
    } else {
      // el cierre ganó: la mensual cerrada conserva su recibo y la baja se rechazó
      expect([cierre.status, l.estado, recibo]).toEqual([201, 'CERRADA', 1]);
      expect(baja.body.message).toBe('La liquidación mensual de 11/2026 ya incluye al empleado: reábrala antes de darlo de baja');
    }
  });
});
