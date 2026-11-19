import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, sesionConPlan } from './helpers';

interface Regimen { id: string; codigoSire: string | null; descripcion: string; porcentaje: string }

describe('retenciones de IVA y SUSS: configuración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('precarga de regímenes', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const iva = (await http.get('/api/pagos/config/regimenes-iva')).body as { regimenes: Regimen[]; avisos: string[] };
    expect(iva.regimenes.map((r) => Number(r.porcentaje)).sort((a, b) => a - b)).toEqual([50, 80, 100]);
    expect(iva.regimenes.every((r) => r.codigoSire === null)).toBe(true);
    expect(iva.avisos).toContain('Cargue el código SIRE del régimen Compraventa de cosas muebles');
    const suss = (await http.get('/api/pagos/config/regimenes-suss')).body as { regimenes: Regimen[]; avisos: string[] };
    expect(suss.regimenes.map((r) => Number(r.porcentaje)).sort((a, b) => a - b)).toEqual([1.2, 2, 6, 6]);
    expect(suss.avisos).toHaveLength(4);
  });

  it('alta y edición de régimen de IVA', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.post('/api/pagos/config/regimenes-iva', { codigoSire: '499', descripcion: 'Régimen de prueba', porcentaje: 50, minimoComprobante: 0, minimoRetencion: 0 });
    expect([r.status, r.body.codigoSire]).toEqual([201, '499']);
    const m = await http.patch(`/api/pagos/config/regimenes-iva/${r.body.id}`, { porcentaje: 80 });
    expect([m.status, m.body.porcentaje]).toEqual([200, '80']);
    expect((await http.post('/api/pagos/config/regimenes-suss', { codigoSire: '12', descripcion: 'x', porcentaje: 2, minimoNoSujeto: 0, minimoRetencion: 0 })).status).toBe(400);
  });

  it('ficha del proveedor con régimen y exclusión', async () => {
    const s = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, s.empresaId);
    const iva = ((await s.http.get('/api/pagos/config/regimenes-iva')).body.regimenes as Regimen[])[0];
    const suss = ((await s.http.get('/api/pagos/config/regimenes-suss')).body.regimenes as Regimen[])[0];
    const r = await s.http.patch(`/api/terceros/${proveedorId}`, { regimenIvaId: iva.id, regimenSussId: suss.id, exclusionIvaPorcentaje: 50, exclusionIvaPublicacion: '2026-10-01', exclusionIvaHasta: '2026-12-31' });
    expect(r.status).toBe(200);
    expect([r.body.regimenIvaId, r.body.regimenSussId, r.body.exclusionIvaPorcentaje]).toEqual([iva.id, suss.id, 50]);
    const mal = await s.http.patch(`/api/terceros/${proveedorId}`, { exclusionIvaPorcentaje: 30 });
    expect(mal.status).toBe(400);
  });

  it('empresa agente de IVA y SUSS', async () => {
    const { http } = await sesionConPlan(app, prisma);
    const r = await http.patch('/api/empresas/actual', { agenteRetencionIva: true, agenteRetencionSuss: true });
    expect([r.status, r.body.agenteRetencionIva, r.body.agenteRetencionSuss]).toEqual([200, true, true]);
  });
});
