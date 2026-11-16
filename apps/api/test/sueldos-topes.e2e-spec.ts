import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: topes indemnizatorios y modelo de la final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('topes por vigencia', async () => {
    const s = await prepararSueldos(app, prisma);
    expect((await s.http.put('/api/sueldos/topes', { convenioId: s.convenio.id, desdeAnio: 2026, desdeMes: 7, importe: 900000 })).status).toBe(200);
    const vig = async (anio: number, mes: number) => (await s.http.get(`/api/sueldos/topes?convenioId=${s.convenio.id}&anio=${anio}&mes=${mes}`)).body.vigente;
    expect(await vig(2026, 11)).toBe('900000.00');
    expect(await vig(2026, 6)).toBeNull();
    expect((await s.http.get(`/api/sueldos/topes?convenioId=${s.convenio.id}`)).body.topes).toHaveLength(1);
  });

  it('configuración con indemnizaciones', async () => {
    const s = await prepararSueldos(app, prisma);
    expect((await s.http.get('/api/sueldos/configuracion')).body.cuentaIndemnizaciones.codigo).toBe('5.2.11');
  });

  it('dos finales en el mismo mes', async () => {
    const s = await prepararSueldos(app, prisma);
    const base = { empresaId: s.empresaId, anio: 2026, mes: 11, fechaPago: new Date('2026-11-30T00:00:00Z'), creadoPor: 'x' };
    await prisma.liquidacion.create({ data: { ...base, numero: 1, tipo: 'FINAL' } });
    await prisma.liquidacion.create({ data: { ...base, numero: 2, tipo: 'FINAL' } });
    await prisma.liquidacion.create({ data: { ...base, numero: 3, tipo: 'MENSUAL' } });
    await expect(prisma.liquidacion.create({ data: { ...base, numero: 4, tipo: 'MENSUAL' } })).rejects.toThrow();
  });
});
