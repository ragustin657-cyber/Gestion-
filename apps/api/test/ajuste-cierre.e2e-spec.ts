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

  it('el ejercicio siguiente exige el cierre del anterior y parte de su apertura reexpresada', async () => {
    const e = await listoParaCerrar();
    expect((await e.generar()).status).toBe(201);
    await e.indices({ '2027-01': 132 });
    const previa = () => e.s.http.get('/api/contabilidad/ajuste-inflacion/previa?fecha=2027-01-31');
    const antes = await previa();
    expect(antes.status).toBe(400);
    expect(antes.body.message).toBe('Cierre primero el ejercicio 1');
    expect((await e.cerrar()).status).toBe(200);
    const r = await previa();
    expect(r.status).toBe(200);
    const aj = Object.fromEntries((r.body.cuentas as { codigo: string; ajuste: string }[]).map((c) => [c.codigo, c.ajuste]));
    expect(aj).toMatchObject({ '1.2.01.001': '12.00', '1.2.01.002': '144.00', '3.1.01': '-240.00', '3.2.01': '36.00', '3.2.02': '-2.00' });
    expect(r.body.recpam).toBe('-50.00');
  });
});
