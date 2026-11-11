import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioAjuste, escenarioEjemplo, INDICES_EJEMPLO } from './helpers-ajuste';

type Fila = { codigo: string; saldoContable: string; reexpresado: string; ajuste: string; cuentaAjuste: string | null };
type Ren = { cuentaContableId: string; debe?: string; haber?: string };

describe('ajuste por inflación: cálculo y vista previa', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const previa = (e: Awaited<ReturnType<typeof escenarioAjuste>>, fecha: string) => e.s.http.get(`/api/contabilidad/ajuste-inflacion/previa?fecha=${fecha}`);
  async function renglones(e: Awaited<ReturnType<typeof escenarioAjuste>>, rs: Ren[]) {
    const cuentas = await prisma.cuentaContable.findMany({ where: { empresaId: e.s.empresaId } });
    const cod = new Map(cuentas.map((c) => [c.id, c.codigo]));
    return rs.map((r) => [cod.get(r.cuentaContableId), r.debe ? `D ${r.debe}` : `H ${r.haber}`]);
  }

  it('reproduce el ejemplo del spec', async () => {
    const e = await escenarioEjemplo(app, prisma);
    const r = await previa(e, '2026-03-31');
    expect(r.status).toBe(200);
    const filas = (r.body.cuentas as Fila[]).map((f) => [f.codigo, f.saldoContable, f.reexpresado, f.ajuste, f.cuentaAjuste]);
    expect(filas).toEqual([
      ['1.2.01.001', '120.00', '120.00', '0.00', null],
      ['1.2.01.002', '600.00', '1440.00', '840.00', null],
      ['3.1.01', '-1000.00', '-2400.00', '-1400.00', '3.1.02'],
      ['3.2.01', '0.00', '360.00', '360.00', null],
      ['4.1.01', '-220.00', '-240.00', '-20.00', null],
    ]);
    expect(r.body.recpam).toBe('-220.00');
    expect(r.body.avisos).toEqual([]);
    expect(r.body.ejercicio).toEqual({ id: e.ej.id, numero: 1 });
    expect(await renglones(e, r.body.renglones)).toEqual([
      ['1.2.01.002', 'D 840.00'], ['3.1.02', 'H 1400.00'], ['3.2.01', 'D 360.00'], ['4.1.01', 'H 20.00'], ['4.2.03', 'D 220.00'],
    ]);
  });

  it('avisa lo no anticuado y lo toma al inicio del ejercicio', async () => {
    const e = await escenarioEjemplo(app, prisma);
    await e.config({ anticuacion: [
      { cuentaContableId: await e.s.cuenta('1.2.01.002'), tramos: [{ anio: 2025, mes: 6, importe: 400 }] },
      { cuentaContableId: await e.s.cuenta('3.1.01'), tramos: [{ anio: 2025, mes: 6, importe: -1000 }] },
    ] });
    const r = await previa(e, '2026-03-31');
    expect(r.body.avisos).toEqual(['1.2.01.002: 200.00 sin anticuar, se toma al inicio del ejercicio']);
    expect((r.body.cuentas as Fila[]).find((f) => f.codigo === '1.2.01.002')!.reexpresado).toBe('1260.00');
  });

  it('informa los índices faltantes', async () => {
    const e = await escenarioEjemplo(app, prisma);
    await prisma.indiceInflacion.deleteMany({ where: { anio: 2026, mes: 2 } });
    expect((await previa(e, '2026-03-31')).body.message).toBe('Faltan los índices de: 02/2026');
    await prisma.indiceInflacion.deleteMany({ where: { anio: 2025, mes: 6 } });
    expect((await previa(e, '2026-03-31')).body.message).toBe('Faltan los índices de: 06/2025, 02/2026');
  });

  it('valida la fecha y la configuración', async () => {
    const e = await escenarioAjuste(app, prisma);
    expect((await previa(e, '2026-03-31')).body.message).toBe('Configure el ajuste por inflación');
    await e.indices(INDICES_EJEMPLO);
    await e.config({ anticuacion: [] });
    expect((await previa(e, '2026-03-30')).body.message).toBe('La fecha debe ser el último día de un mes');
    expect((await previa(e, 'xx')).status).toBe(400);
    expect((await previa(e, '2025-12-31')).status).toBe(400);
  });

  it('las cuentas monetarias no se reexpresan', async () => {
    const e = await escenarioEjemplo(app, prisma);
    await e.s.http.patch(`/api/plan-cuentas/${await e.s.cuenta('4.1.01')}`, { monetaria: true });
    const r = await previa(e, '2026-03-31');
    expect((r.body.cuentas as Fila[]).map((f) => f.codigo)).not.toContain('4.1.01');
    expect(r.body.recpam).toBe('-200.00');
  });

  it('sin anticuación toma la apertura al inicio del ejercicio', async () => {
    const e = await escenarioEjemplo(app, prisma, false);
    const r = await previa(e, '2026-03-31');
    expect(r.body.avisos).toEqual([
      '1.2.01.002: 600.00 sin anticuar, se toma al inicio del ejercicio',
      '3.1.01: -1000.00 sin anticuar, se toma al inicio del ejercicio',
    ]);
    // Rodados 600 × 120/80 = 900; capital 1000 × 1,5 = 1500; RNA sin reexpresión de apertura
    const f = Object.fromEntries((r.body.cuentas as Fila[]).map((x) => [x.codigo, x.ajuste]));
    expect(f).toEqual({ '1.2.01.001': '0.00', '1.2.01.002': '300.00', '3.1.01': '-500.00', '4.1.01': '-20.00' });
    expect(r.body.recpam).toBe('-220.00');
  });
});
