import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { escenarioEjemplo } from './helpers-ajuste';

type Ren = { cuentaContableId: string; debe: string; haber: string };
type Esc = Awaited<ReturnType<typeof escenarioEjemplo>>;

describe('ajuste por inflación: asiento, anulación y Excel', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const generar = (e: Esc, fecha: string) => e.s.http.post('/api/contabilidad/ajuste-inflacion', { fecha });
  const anular = (e: Esc, id: string) => e.s.http.post(`/api/contabilidad/ajuste-inflacion/${id}/anular`, { motivo: 'Corrección' });
  const previa = (e: Esc, fecha: string) => e.s.http.get(`/api/contabilidad/ajuste-inflacion/previa?fecha=${fecha}`);
  async function renglonesDe(e: Esc, asientoId: string) {
    const rs = await prisma.asientoRenglon.findMany({ where: { asientoId } });
    const cuentas = await prisma.cuentaContable.findMany({ where: { empresaId: e.s.empresaId } });
    const cod = new Map(cuentas.map((c) => [c.id, c.codigo]));
    return rs.map((r) => [cod.get(r.cuentaContableId)!, Number(r.debe) ? `D ${Number(r.debe).toFixed(2)}` : `H ${Number(r.haber).toFixed(2)}`])
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }));
  }
  const EJEMPLO = [['1.2.01.002', 'D 840.00'], ['3.1.02', 'H 1400.00'], ['3.2.01', 'D 360.00'], ['4.1.01', 'H 20.00'], ['4.2.03', 'D 220.00']];

  it('genera el asiento del ejemplo', async () => {
    const e = await escenarioEjemplo(app, prisma);
    const r = await generar(e, '2026-03-31');
    expect(r.status).toBe(201);
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(a).toMatchObject({ tipo: 'AJUSTE_INFLACION', origenTipo: 'AJUSTE_INFLACION', origenId: `${e.ej.id}:2026-03`, descripcion: 'Ajuste por inflación al 31/03/2026' });
    expect(a.fecha.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(await renglonesDe(e, a.id)).toEqual(EJEMPLO);
    expect((await previa(e, '2026-03-31')).body.renglones).toEqual([]);
    const otra = await generar(e, '2026-03-31');
    expect(otra.status).toBe(400);
    expect(otra.body.message).toBe('No hay diferencias para ajustar');
    const lista = (await e.s.http.get('/api/contabilidad/ajuste-inflacion')).body;
    expect(lista).toEqual([expect.objectContaining({ asientoId: a.id, fecha: '2026-03-31', ejercicio: 1, recpam: '-220.00', anulado: false })]);
  });

  it('complementario con gasto de febrero; con gasto de marzo no hay diferencias', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await generar(e, '2026-03-31')).status).toBe(201);
    await e.asiento('2026-03-20', [['5.2.01', 100, 0], ['1.1.01.002', 0, 100]]);
    expect((await generar(e, '2026-03-31')).body.message).toBe('No hay diferencias para ajustar');
    await e.asiento('2026-02-20', [['5.2.01', 100, 0], ['1.1.01.002', 0, 100]]);
    const r = await generar(e, '2026-03-31');
    expect(r.status).toBe(201);
    expect(await renglonesDe(e, r.body.id)).toEqual([['4.2.03', 'H 9.09'], ['5.2.01', 'D 9.09']]);
  });

  it('cuenta reclasificada después de un ajuste: no revierte lo registrado', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await generar(e, '2026-03-31')).status).toBe(201);
    await e.s.http.patch(`/api/plan-cuentas/${await e.s.cuenta('4.1.01')}`, { monetaria: true });
    expect((await previa(e, '2026-03-31')).body.renglones).toEqual([]);
  });

  it('rechaza una fecha anterior al último ajuste', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await generar(e, '2026-03-31')).status).toBe(201);
    const r = await generar(e, '2026-02-28');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Ya hay un ajuste al 31/03/2026: genere uno a esa fecha o posterior');
  });

  it('anula solo el último y el siguiente lo recalcula', async () => {
    const e = await escenarioEjemplo(app, prisma);
    const feb = await generar(e, '2026-02-28');
    const mar = await generar(e, '2026-03-31');
    expect([feb.status, mar.status]).toEqual([201, 201]);
    const r1 = await anular(e, feb.body.id);
    expect(r1.body.message).toBe('Solo se puede anular el último ajuste (31/03/2026)');
    const r2 = await anular(e, mar.body.id);
    expect(r2.status).toBe(201);
    const contra = await prisma.asiento.findFirstOrThrow({ where: { anulaAId: mar.body.id } });
    expect(contra.fecha.toISOString().slice(0, 10)).toBe('2026-03-31');
    const marAntes = await renglonesDe(e, mar.body.id);
    const p = (await previa(e, '2026-03-31')).body.renglones as Ren[];
    expect(p.length).toBe(marAntes.length);
    const lista = (await e.s.http.get('/api/contabilidad/ajuste-inflacion')).body;
    expect(lista.map((x: { fecha: string; anulado: boolean }) => [x.fecha, x.anulado])).toEqual([['2026-03-31', true], ['2026-02-28', false]]);
    expect((await anular(e, mar.body.id)).body.message).toBe('Solo se puede anular el último ajuste (28/02/2026)');
    const generica = await e.s.http.post(`/api/contabilidad/asientos/${feb.body.id}/anular`, { fecha: '2026-02-28', motivo: 'x' });
    expect(generica.status).toBe(400);
    expect(generica.body.message).toBe('Anule el ajuste desde Ajuste por inflación');
    // el ajuste de febrero más el nuevo de marzo dan el ejemplo completo
    const nuevo = await generar(e, '2026-03-31');
    expect(nuevo.status).toBe(201);
  });

  it('no cambia el primer ejercicio con ajustes vigentes', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await generar(e, '2026-03-31')).status).toBe(201);
    const sig = await e.s.http.post('/api/contabilidad/ejercicios/siguiente', {});
    const r = await e.s.http.put('/api/contabilidad/ajuste-inflacion/config', { primerEjercicioId: sig.body.id, anticuacion: [] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Hay ajustes generados: anúlelos antes de cambiar el primer ejercicio');
  });

  it('dos generaciones simultáneas no duplican el ajuste', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const e = await escenarioEjemplo(app, prisma);
      const rs = await Promise.all([generar(e, '2026-03-31'), generar(e, '2026-03-31')]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(rs.find((r) => r.status === 400)!.body.message).toBe('No hay diferencias para ajustar');
    }
  });

  it('el ejercicio siguiente exige el ajuste al cierre del anterior', async () => {
    const e = await escenarioEjemplo(app, prisma);
    expect((await e.s.http.post('/api/contabilidad/ejercicios/siguiente', {})).status).toBe(201);
    const r = await previa(e, '2027-01-31');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Genere primero el ajuste al cierre del ejercicio 1');
  });

  it('exporta la previa a Excel', async () => {
    const e = await escenarioEjemplo(app, prisma);
    const r = await e.s.http.get('/api/contabilidad/ajuste-inflacion/previa?fecha=2026-03-31&formato=xlsx').buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const ws = wb.worksheets[0];
    const filas: unknown[][] = [];
    ws.eachRow((row) => filas.push((row.values as unknown[]).slice(1)));
    expect(filas).toContainEqual(['Código', 'Cuenta', 'Saldo contable', 'Reexpresado', 'Ajuste']);
    expect(filas).toContainEqual(['1.2.01.002', 'Rodados', 600, 1440, 840]);
    expect(filas[filas.length - 1]).toEqual(['RECPAM', 'Resultado por exposición a la inflación (RECPAM)', undefined, undefined, -220]);
  });
});
