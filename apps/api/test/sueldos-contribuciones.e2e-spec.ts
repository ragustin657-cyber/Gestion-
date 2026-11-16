import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('sueldos: contribuciones y parámetros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('empresa nueva trae contribuciones, parámetros, cuentas y configuración', async () => {
    const s = await prepararSueldos(app, prisma);
    const cs = (await s.http.get('/api/sueldos/contribuciones')).body as { codigo: string; alicuota: string; desdeAnio: number; desdeMes: number }[];
    expect(cs.map((c) => c.codigo).sort()).toEqual(['AAFF', 'ART', 'FNE', 'OS', 'PAMI', 'SCVO', 'SIPA']);
    expect(cs.find((c) => c.codigo === 'SIPA')).toMatchObject({ alicuota: '10.77', desdeAnio: 2026, desdeMes: 1 });
    expect((await s.http.get('/api/sueldos/parametros?anio=2026&mes=11')).body).toMatchObject({ anio: 2026, mes: 1, baseMaximaAportes: '3500000.00', detraccion: '7003.68' });
    const cfg = (await s.http.get('/api/sueldos/configuracion')).body as Record<string, { codigo: string } | null>;
    expect([cfg.cuentaSueldos?.codigo, cfg.cuentaContribuciones?.codigo, cfg.cuentaSueldosAPagar?.codigo, cfg.cuentaCargasSociales?.codigo, cfg.cuentaRetencionesSindicales?.codigo])
      .toEqual(['5.2.09', '5.2.10', '2.1.03.001', '2.1.03.002', '2.1.03.003']);
    const conceptos = (await s.http.get('/api/sueldos/conceptos')).body as { codigo: string; destino: string; parametros: Record<string, unknown> }[];
    expect(conceptos.find((c) => c.codigo === '540')!.destino).toBe('SINDICAL');
    expect(conceptos.find((c) => c.codigo === '500')!.parametros.tope).toBe('BASE_MAXIMA');
  });

  it('vigencias', async () => {
    const s = await prepararSueldos(app, prisma);
    const sipa = ((await s.http.get('/api/sueldos/contribuciones')).body as { codigo: string; cuentaContableId: string }[]).find((c) => c.codigo === 'SIPA')!;
    const r = await s.http.post('/api/sueldos/contribuciones', { codigo: 'SIPA', nombre: 'Jubilación (SIPA)', destino: 'SEGURIDAD_SOCIAL', alicuota: 12.35, importeFijo: 0, aplicaDetraccion: true, cuentaContableId: sipa.cuentaContableId, desdeAnio: 2026, desdeMes: 12 });
    expect(r.status).toBe(201);
    const vig = async (mes: number) => ((await s.http.get(`/api/sueldos/contribuciones?anio=2026&mes=${mes}`)).body as { codigo: string; alicuota: string }[]).find((c) => c.codigo === 'SIPA')!.alicuota;
    expect(await vig(11)).toBe('10.77');
    expect(await vig(12)).toBe('12.35');
  });

  it('parámetros por mes', async () => {
    const s = await prepararSueldos(app, prisma);
    expect((await s.http.put('/api/sueldos/parametros', { anio: 2026, mes: 11, baseMaximaAportes: 3800000, detraccion: 7500 })).status).toBe(200);
    expect((await s.http.get('/api/sueldos/parametros?anio=2026&mes=12')).body).toMatchObject({ anio: 2026, mes: 11, baseMaximaAportes: '3800000.00', detraccion: '7500.00' });
    expect((await s.http.get('/api/sueldos/parametros?anio=2026&mes=10')).body).toMatchObject({ mes: 1, detraccion: '7003.68' });
  });

  it('empleado con datos F.931', async () => {
    const s = await prepararSueldos(app, prisma);
    const e = await s.empleado({ codigoObraSocial: '125000', conyuge: true, cantidadHijos: 2 });
    const x = ((await s.http.get('/api/sueldos/empleados')).body as Record<string, unknown>[]).find((y) => y.id === e.id)!;
    expect(x).toMatchObject({ codigoObraSocial: '125000', conyuge: true, cantidadHijos: 2, codigoSituacion: 1, codigoModalidad: 8, codigoActividad: 49 });
    expect((await s.http.put(`/api/sueldos/empleados/${e.id}`, { codigoObraSocial: '12' })).status).toBe(400);
  });

  it('permisos', async () => {
    const s = await prepararSueldos(app, prisma);
    const solo = (await otroUsuario(app, prisma, s.empresaId, ['sueldos.ver'])).http;
    expect((await solo.get('/api/sueldos/contribuciones')).status).toBe(200);
    expect((await solo.post('/api/sueldos/contribuciones', {})).status).toBe(403);
    expect((await solo.put('/api/sueldos/configuracion', {})).status).toBe(403);
  });
});
