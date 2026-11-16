import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: modelo de vacaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('empresa nueva trae conceptos de vacaciones', async () => {
    const s = await prepararSueldos(app, prisma);
    const cs = (await s.http.get('/api/sueldos/conceptos')).body as { codigo: string; tipo: string; parametros: Record<string, unknown> }[];
    expect(cs.find((c) => c.codigo === '150')).toMatchObject({ tipo: 'VACACIONES', parametros: { divisor: 25 } });
    expect(cs.find((c) => c.codigo === '151')).toMatchObject({ tipo: 'VACACIONES', parametros: { divisor: 30, descuenta: true } });
    expect((await prisma.configuracionSueldos.findFirstOrThrow({ where: { empresaId: s.empresaId } })).anioInicioVacaciones).toBe(2026);
  });

  it('concepto de vacaciones inválido', async () => {
    const s = await prepararSueldos(app, prisma);
    const r = await s.http.post('/api/sueldos/conceptos', { codigo: '152', nombre: 'X', clase: 'DESCUENTO', tipo: 'VACACIONES', parametros: { divisor: 25 }, orden: 152 });
    expect([r.status, r.body.message]).toEqual([400, 'El cálculo Vacaciones no admite la clase Descuento']);
  });
});
