import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

type Recibo = { empleadoId: string; renglones: { codigo: string; importe: string }[] };

describe('sueldos: correcciones de la revisión (entrega 21)', () => {
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
    const recibo = async (id: string) => ((await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body.recibos as Recibo[]).find((r) => r.empleadoId === e.id)!;
    const codigos = (r: Recibo) => r.renglones.map((x) => x.codigo);
    return { ...s, e, recibo, codigos };
  };

  it('con un solo concepto de vacaciones activo no se liquida ninguno', async () => {
    for (const inactivo of ['150', '151']) {
      await limpiarBase(prisma);
      const x = await escenario();
      await prisma.concepto.updateMany({ where: { empresaId: x.empresaId, codigo: inactivo }, data: { activo: false } });
      const m = (await x.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
      await x.http.post('/api/sueldos/vacaciones', { empleadoId: x.e.id, anio: 2026, desde: '2026-11-09', hasta: '2026-11-22' });
      const cs = x.codigos(await x.recibo(m.id));
      expect([cs.includes('150'), cs.includes('151')]).toEqual([false, false]);
    }
  });

  it('vacaciones pagadas que cruzan el egreso cuentan enteras como tomadas', async () => {
    const x = await escenario();
    // 14 días del 25/10 al 07/11, pagados en la mensual de octubre; egreso el 01/11
    await x.http.post('/api/sueldos/vacaciones', { empleadoId: x.e.id, anio: 2026, desde: '2026-10-25', hasta: '2026-11-07', liquidadoAfuera: true });
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-11-01', preavisoOtorgado: false, fechaPago: '2026-11-05' }));
    expect(f.status).toBe(201);
    const r = await x.recibo(f.body.id);
    // 21 × 305/365 = 17,548 días proporcionales − 14 tomados = 3,548 días
    const esperado = (1137465 / 25 * (21 * 305 / 365 - 14)).toFixed(2);
    expect(r.renglones.find((y) => y.codigo === '330')!.importe).toBe(esperado);
  });
});
