import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioEjemplo } from './helpers-ajuste';

describe('ajuste por inflación: cierre del ejercicio', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function listoParaCerrar() {
    const e = await escenarioEjemplo(app, prisma);
    const resto: Record<string, number> = {};
    for (let m = 4; m <= 12; m++) resto[`2026-${String(m).padStart(2, '0')}`] = 120;
    await e.indices(resto);
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { id: e.ej.id }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    for (let i = 0; i < 11; i++) expect((await e.s.http.post(`/api/contabilidad/periodos/${ej.periodos[i].id}/cerrar`, {})).status).toBe(200);
    expect((await e.s.http.post('/api/contabilidad/ejercicios/siguiente', {})).status).toBe(201);
    const faltantes = async () => (await e.s.http.get(`/api/contabilidad/ejercicios/${ej.id}/cierre/previa`)).body.faltantes as string[];
    const cerrar = () => e.s.http.post(`/api/contabilidad/ejercicios/${ej.id}/cerrar`, {});
    const generar = () => e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha: '2026-12-31' });
    return { ...e, faltantes, cerrar, generar };
  }

  it('exige el ajuste al cierre y que esté al día', async () => {
    const e = await listoParaCerrar();
    expect(await e.faltantes()).toEqual(['Genere el ajuste por inflación al cierre']);
    const r = await e.cerrar();
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Genere el ajuste por inflación al cierre');
    expect((await e.generar()).status).toBe(201);
    expect(await e.faltantes()).toEqual([]);
    await e.indices({ '2026-12': 132 });
    expect(await e.faltantes()).toEqual(['El ajuste por inflación al cierre está desactualizado: genere uno nuevo']);
    expect((await e.generar()).status).toBe(201);
    expect(await e.faltantes()).toEqual([]);
    expect((await e.cerrar()).status).toBe(200);
  });

  it('informa los índices faltantes', async () => {
    const e = await listoParaCerrar();
    await prisma.indiceInflacion.deleteMany({ where: { anio: 2026, mes: 12 } });
    expect(await e.faltantes()).toContain('Faltan los índices de: 12/2026');
  });
});
