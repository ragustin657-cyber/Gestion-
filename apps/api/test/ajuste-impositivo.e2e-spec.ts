import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

type Planilla = {
  estatico: { cuentas: { codigo: string; saldo: string }[]; activo: string; pasivo: string; base: string; coeficiente: string; ajuste: string };
  dinamico: { movimientos: { tipo: string; importe: string; ajuste: string; descripcion: string }[]; total: string };
  partidas: { id: string }[]; avisoApertura: string | null; variacion36: string; corresponde: boolean; total: string; totalDj: string; aviso: string | null;
};
const INDICES: Record<string, number> = { '2023-12': 50, '2024-12': 40, '2025-12': 100, '2026-03': 110, '2026-05': 120, '2026-07': 125, '2026-08': 130, '2026-10': 140, '2026-12': 150, '2027-12': 300 };

describe('ajuste por inflación impositivo (E45)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let numero = 9000;
  const escenario = async (o: { indices?: Record<string, number>; aperturaManual?: boolean; sinApertura?: boolean } = {}) => {
    const s = await sesionConPlan(app, prisma);
    for (const [k, valor] of Object.entries({ ...INDICES, ...o.indices })) await prisma.indiceInflacion.create({ data: { anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)), valor, actualizadoPor: 't' } });
    const ej = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: s.empresaId, numero: 1 }, include: { periodos: { orderBy: { mes: 'asc' } } } });
    const c = (codigo: string) => s.cuenta(codigo);
    const asiento = async (fecha: string, descripcion: string, renglones: object[]) => {
      const r = await s.http.post('/api/contabilidad/asientos', { fecha, descripcion, renglones });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const ren = async (codigo: string, debe: number, haber: number) => ({ empresaId: s.empresaId, cuentaContableId: await c(codigo), debe, haber });
    const apertura = [await ren('1.1.01.001', 1000000, 0), await ren('2.1.01.001', 0, 400000), await ren('3.1.01', 0, 600000)];
    if (o.aperturaManual) {
      const a = await asiento('2026-01-01', 'Apertura', apertura.map((r) => ({ cuentaContableId: r.cuentaContableId, ...(r.debe ? { debe: r.debe } : { haber: r.haber }) })));
      await prisma.configAjusteInflacion.create({ data: { empresaId: s.empresaId, primerEjercicioId: ej.id, asientoAperturaId: a.id, actualizadoPor: 't' } });
    } else if (!o.sinApertura) {
      await prisma.asiento.create({ data: { empresaId: s.empresaId, numero: ++numero, fecha: ej.desde, descripcion: 'Apertura', origenTipo: 'APERTURA', origenId: ej.id, creadoPor: 't', tipo: 'APERTURA', ejercicioId: ej.id, renglones: { create: apertura } } });
    }
    await asiento('2026-03-10', 'Compra de rodado', [{ cuentaContableId: await c('1.2.01.002'), debe: 200000 }, { cuentaContableId: await c('1.1.01.001'), haber: 200000 }]);
    await asiento('2026-05-10', 'Aporte de capital', [{ cuentaContableId: await c('1.1.01.002'), debe: 100000 }, { cuentaContableId: await c('3.1.01'), haber: 100000 }]);
    await asiento('2026-07-10', 'Dividendo pagado', [{ cuentaContableId: await c('3.2.01'), debe: 50000 }, { cuentaContableId: await c('1.1.01.001'), haber: 50000 }]);
    await asiento('2026-08-10', 'Reclasificación', [{ cuentaContableId: await c('3.1.02'), debe: 10000 }, { cuentaContableId: await c('3.2.01'), haber: 10000 }]);
    await asiento('2026-10-10', 'Venta de rodado', [{ cuentaContableId: await c('1.1.01.001'), debe: 30000 }, { cuentaContableId: await c('1.2.01.002'), haber: 30000 }]);
    await prisma.asiento.create({ data: { empresaId: s.empresaId, numero: ++numero, fecha: new Date('2026-08-31'), descripcion: 'Amortización', origenTipo: 'AMORTIZACION', origenId: ej.id, creadoPor: 't', ejercicioId: ej.id, renglones: { create: [await ren('5.2.07', 5000, 0), await ren('1.2.02.002', 0, 5000)] } } });
    const planilla = (ejercicioId = ej.id, extra = '') => s.http.get(`/api/impuestos/ajuste-inflacion?ejercicioId=${ejercicioId}${extra}`);
    const datos = async (ejercicioId = ej.id) => { const r = await planilla(ejercicioId); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body as Planilla; };
    return { ...s, ej, planilla, datos };
  };

  it('estático y dinámico desde el Mayor (apertura inicial, aportes, dividendos, compras y ventas de excluidos)', async () => {
    const x = await escenario();
    const p = await x.datos();
    expect([p.estatico.activo, p.estatico.pasivo, p.estatico.base, p.estatico.ajuste]).toEqual(['1000000.00', '400000.00', '600000.00', '-300000.00']);
    expect(p.estatico.cuentas.map((k) => k.codigo)).toEqual(['1.1.01.001', '2.1.01.001']);
    expect(p.dinamico.movimientos.map((m) => [m.tipo, m.importe, m.ajuste])).toEqual([
      ['COMPRA_EXCLUIDO', '200000.00', '72727.27'], ['APORTE', '-100000.00', '-25000.00'], ['RETIRO', '50000.00', '10000.00'], ['VENTA_EXCLUIDO', '-30000.00', '-2142.86'],
    ]);
    expect([p.dinamico.total, p.total, p.totalDj, p.corresponde, p.aviso]).toEqual(['55584.41', '-244415.59', '-244415.59', true, null]);
  });

  it('apertura inicial como asiento manual configurado: entra al estático y no al dinámico', async () => {
    const x = await escenario({ aperturaManual: true });
    const p = await x.datos();
    expect(p.estatico.ajuste).toBe('-300000.00');
    expect(p.dinamico.movimientos.map((m) => m.descripcion)).not.toContain('Apertura');
    expect(p.dinamico.movimientos).toHaveLength(4);
  });

  it('partidas manuales: alta, validación, modificación y baja', async () => {
    const x = await escenario();
    const alta = await x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'Valuación impositiva de bienes de cambio', tipo: 'ACTIVO_INICIO', importe: 40000 });
    expect(alta.status).toBe(201);
    expect((await x.datos()).estatico.ajuste).toBe('-320000.00');
    expect((await x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'Retiro', tipo: 'DINAMICO', importe: 1000 })).status).toBe(400);
    expect((await x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'Nada', tipo: 'ACTIVO_INICIO', importe: 0 })).status).toBe(400);
    const din = await x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'Retiro no identificado', tipo: 'DINAMICO', fecha: '2026-07-20', importe: 1000 });
    expect(din.status).toBe(201);
    const p = await x.datos();
    expect(p.dinamico.movimientos.find((m) => m.tipo === 'MANUAL')?.ajuste).toBe('200.00');
    expect((await x.http.put(`/api/impuestos/ajuste-inflacion/partidas/${alta.body.id}`, { ejercicioId: x.ej.id, concepto: 'Valuación', tipo: 'ACTIVO_INICIO', importe: 20000 })).status).toBe(200);
    expect((await x.datos()).estatico.ajuste).toBe('-310000.00');
    expect((await x.http.delete(`/api/impuestos/ajuste-inflacion/partidas/${din.body.id}`)).status).toBe(200);
    const r = await x.http.delete(`/api/impuestos/ajuste-inflacion/partidas/${din.body.id}`);
    expect([r.status, r.body.message]).toEqual([404, 'Partida no encontrada']);
  });

  it('variación de 36 meses no supera el 100 %: el total a la DJ es cero', async () => {
    const x = await escenario({ indices: { '2023-12': 80 } });
    const p = await x.datos();
    expect([p.corresponde, p.totalDj, p.aviso, p.total]).toEqual([false, '0.00', 'No corresponde aplicar el ajuste: la variación de los últimos 36 meses es 87,50 %', '-244415.59']);
  });

  it('falta el índice del cierre: error', async () => {
    const x = await escenario();
    await prisma.indiceInflacion.deleteMany({ where: { anio: 2026, mes: 12 } });
    const r = await x.planilla();
    expect([r.status, r.body.message]).toEqual([400, 'Faltan los índices de: 12/2026']);
  });

  it('segundo ejercicio después del cierre: saldos al inicio nominales, sin duplicar', async () => {
    const x = await escenario();
    for (const p of x.ej.periodos.slice(0, 11)) expect((await x.http.post(`/api/contabilidad/periodos/${p.id}/cerrar`, {})).status).toBe(200);
    await x.http.post('/api/contabilidad/ejercicios/siguiente', {});
    const cierre = await x.http.post(`/api/contabilidad/ejercicios/${x.ej.id}/cerrar`, {});
    expect(cierre.status).toBe(200);
    const ej2 = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: 2 } });
    const p = await x.datos(ej2.id);
    // caja 1.000.000 − 200.000 − 50.000 + 30.000 y banco 100.000; proveedores 400.000
    expect([p.estatico.activo, p.estatico.pasivo]).toEqual(['880000.00', '400000.00']);
    expect(p.dinamico.movimientos).toEqual([]);
  });

  it('clasificación de la cuenta, Excel, validación y permiso', async () => {
    const x = await escenario();
    const id = await x.cuenta('1.1.01.003');
    expect((await x.http.patch(`/api/plan-cuentas/${id}`, { ajusteImpositivo: 'EXCLUIDO' })).status).toBe(200);
    expect((await prisma.cuentaContable.findUniqueOrThrow({ where: { id } })).ajusteImpositivo).toBe('EXCLUIDO');
    expect((await prisma.cuentaContable.findUniqueOrThrow({ where: { id: await x.cuenta('1.2.01.002') } })).ajusteImpositivo).toBe('EXCLUIDO');
    expect((await x.planilla(x.ej.id, '&formato=xlsx')).headers['content-type']).toContain('spreadsheetml');
    const r = await x.http.get('/api/impuestos/ajuste-inflacion');
    expect([r.status, r.body.message]).toEqual([400, 'Indique el ejercicio']);
    const otro = await otroUsuario(app, prisma, x.empresaId, ['bienes.ver']);
    expect((await otro.http.get(`/api/impuestos/ajuste-inflacion?ejercicioId=${x.ej.id}`)).status).toBe(403);
  });

  it('revisión: sin apertura inicial ni configuración, la planilla igual lee el Mayor y avisa', async () => {
    const x = await escenario({ sinApertura: true });
    const p = await x.datos();
    expect(p.dinamico.movimientos.map((m) => m.tipo)).toEqual(['COMPRA_EXCLUIDO', 'APORTE', 'RETIRO', 'VENTA_EXCLUIDO']);
    expect(p.avisoApertura).toBe('No se encontró la apertura inicial del primer ejercicio: configúrela en el ajuste por inflación contable o cargue los saldos al inicio como partidas manuales');
    for (const per of x.ej.periodos.slice(0, 11)) expect((await x.http.post(`/api/contabilidad/periodos/${per.id}/cerrar`, {})).status).toBe(200);
    await x.http.post('/api/contabilidad/ejercicios/siguiente', {});
    expect((await x.http.post(`/api/contabilidad/ejercicios/${x.ej.id}/cerrar`, {})).status).toBe(200);
    const ej2 = await prisma.ejercicio.findFirstOrThrow({ where: { empresaId: x.empresaId, numero: 2 } });
    // caja −200.000 − 50.000 + 30.000 y banco 100.000
    expect((await x.datos(ej2.id)).estatico.activo).toBe('-120000.00');
  });

  it('revisión: la fecha de la partida dinámica tiene que estar dentro del ejercicio', async () => {
    const x = await escenario();
    const r = await x.http.post('/api/impuestos/ajuste-inflacion/partidas', { ejercicioId: x.ej.id, concepto: 'Retiro', tipo: 'DINAMICO', fecha: '2019-05-01', importe: 1000 });
    expect([r.status, r.body.message]).toEqual([400, 'La fecha debe estar dentro del ejercicio']);
    expect((await x.datos()).avisoApertura).toBeNull();
  });
});
