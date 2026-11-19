import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { crearEjercicio } from '../src/contabilidad/periodos/ejercicios';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { TABLA_PRUEBA } from './helpers-ganancias';
import { prepararSueldos } from './helpers-sueldos';

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
interface Renglon { codigo: string; importe: string }
interface Recibo { totalRemunerativo: string; totalNoRemunerativo: string; neto: string; renglones: Renglon[]; hojaGanancias: { retenidoAnterior: string } | null }

describe('ganancias: ajuste anual y distracto', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  /** Empresa agente, un empleado con noviembre y diciembre de 2025 cerrados y la anual 2025 cerrada con el saldo indicado. */
  const escenario = async (saldo: number | null = 1000000) => {
    const s = await prepararSueldos(app, prisma);
    await prisma.empresa.update({ where: { id: s.empresaId }, data: { agenteRetencionGanancias: true } });
    await prisma.$transaction((tx) => crearEjercicio(tx, s.empresaId, new Date('2025-01-01T00:00:00Z'), 0));
    await s.escala('Vendedor B', '2025-11', 30000000);
    for (const sem of [1, 2]) for (const anio of [2025, 2026]) await s.http.put(`/api/sueldos/ganancias/tablas/${anio}/${sem}`, TABLA_PRUEBA);
    const e = await s.empleado();
    const crear = async (tipo: string, anio: number, mes: number, dia = 28) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-${dia}` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const cerrar = async (id: string) => { const r = await s.http.post(`/api/sueldos/liquidaciones/${id}/cerrar`); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); };
    for (const mes of [11, 12]) await cerrar((await crear('MENSUAL', 2025, mes)).id);
    if (saldo !== null) {
      expect((await s.http.post('/api/sueldos/ganancias/anual/2025/calcular')).status).toBe(201);
      expect((await s.http.post('/api/sueldos/ganancias/anual/2025/cerrar')).status).toBe(201);
      // El cierre recalcula: el saldo del escenario se fija después
      await prisma.liquidacionAnualGananciasEmpleado.updateMany({ where: { empleadoId: e.id }, data: { saldo } });
    }
    const recibo = async (id: string) => ((await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body.recibos as Recibo[])[0];
    const r561 = (r: Recibo) => r.renglones.find((x) => x.codigo === '561');
    const r560 = (r: Recibo) => D(r.renglones.find((x) => x.codigo === '560')?.importe ?? 0);
    const tope = (r: Recibo) => Prisma.Decimal.max(D(r.totalRemunerativo).plus(r.totalNoRemunerativo).times(0.35).minus(r560(r)), 0).toDecimalPlaces(2);
    return { ...s, e, crear, cerrar, recibo, r561, r560, tope };
  };

  it('el ajuste aparece en la liquidación siguiente', async () => {
    const x = await escenario(1000000);
    const nov = await x.crear('MENSUAL', 2026, 11);
    expect(x.r561(await x.recibo(nov.id))!.importe).toBe('1000000.00');
    const renglon = await prisma.reciboSueldoRenglon.findFirstOrThrow({ where: { codigo: '561', recibo: { liquidacionId: nov.id } } });
    expect(renglon.anioAjusteGanancias).toBe(2025);
  });

  it('tope del 35 por ciento y pendiente', async () => {
    const x = await escenario(100000000);
    const nov = await x.crear('MENSUAL', 2026, 11);
    const rn = await x.recibo(nov.id);
    const aplicadoNov = D(x.r561(rn)!.importe);
    expect(aplicadoNov.toFixed(2)).toBe(x.tope(rn).toFixed(2));
    await x.cerrar(nov.id);
    const dic = await x.crear('MENSUAL', 2026, 12);
    const rd = await x.recibo(dic.id);
    expect(x.r561(rd)!.importe).toBe(Prisma.Decimal.min(D(100000000).minus(aplicadoNov), x.tope(rd)).toFixed(2));
  });

  it('el ajuste no deja el neto negativo', async () => {
    const x = await escenario(100000000);
    // Embargo grande: el neto antes del ajuste es menor que el 35 % disponible
    const c = await x.http.post('/api/sueldos/conceptos', { codigo: '590', nombre: 'Embargo', clase: 'DESCUENTO', tipo: 'FIJO', parametros: { importe: 26000000 }, orden: 590 });
    expect(c.status).toBe(201);
    const nov = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(nov.id);
    expect(D(x.r561(r)!.importe).gt(0)).toBe(true);
    expect(D(x.r561(r)!.importe).lt(x.tope(r))).toBe(true);
    expect(D(r.neto).toFixed(2)).toBe('0.00');
  });

  it('distracto con saldo cero también queda en el F.1359 de distracto', async () => {
    const x = await escenario(null);
    jest.setSystemTime(new Date('2026-02-20T15:00:00Z'));
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' })).body as { id: string };
    // Sin acumulado previo la anual 2025 del empleado da saldo 0: no hay renglón 561, pero sigue siendo distracto
    expect(x.r561(await x.recibo(f.id))).toBeUndefined();
    await x.cerrar(f.id);
    expect(await prisma.liquidacionAnualGananciasEmpleado.count({ where: { empleadoId: x.e.id, distracto: true, liquidacionFinalId: f.id } })).toBe(1);
  });

  it('un distracto cerrado no impide reabrir la anual', async () => {
    const x = await escenario(null);
    expect((await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2025`, { bruta: 0, aportes: 0, retenido: 500000 })).status).toBe(200);
    jest.setSystemTime(new Date('2026-02-20T15:00:00Z'));
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' })).body as { id: string };
    await x.cerrar(f.id);
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    expect((await x.http.post('/api/sueldos/ganancias/anual/2025/calcular')).status).toBe(201);
    expect((await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar')).status).toBe(201);
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/reabrir');
    expect([r.status, r.body.estado]).toEqual([201, 'BORRADOR']);
  });

  it('lo aplicado con otro concepto de ajuste cuenta', async () => {
    const x = await escenario(1000000);
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    await prisma.concepto.updateMany({ where: { codigo: '561' }, data: { activo: false } });
    const c = await x.http.post('/api/sueldos/conceptos', { codigo: '562', nombre: 'Ajuste anual bis', clase: 'DESCUENTO', tipo: 'GANANCIAS_AJUSTE', parametros: {}, orden: 562 });
    expect(c.status).toBe(201);
    const dic = await x.recibo((await x.crear('MENSUAL', 2026, 12)).id);
    expect(dic.renglones.filter((y) => ['561', '562'].includes(y.codigo))).toEqual([]);
  });

  it('aviso sin concepto de ajuste activo', async () => {
    const x = await escenario(1000000);
    await prisma.concepto.updateMany({ where: { codigo: '561' }, data: { activo: false } });
    const r = await x.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-28' });
    expect(r.status).toBe(201);
    const det = await x.http.get(`/api/sueldos/liquidaciones/${r.body.id}`);
    expect(det.body.aviso).toContain('Hay saldos de la liquidación anual de Ganancias sin aplicar: active un concepto de ajuste anual de Ganancias');
  });

  it('el SAC no lleva ajuste', async () => {
    // Saldo grande: después de noviembre sigue quedando ajuste pendiente
    const x = await escenario(100000000);
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    const sac = await x.crear('SAC', 2026, 12, 18);
    expect(x.r561(await x.recibo(sac.id))).toBeUndefined();
  });

  it('no se cierra la anual con finales de enero a marzo sin cerrar', async () => {
    const x = await escenario(null);
    jest.setSystemTime(new Date('2026-03-31T15:00:00Z'));
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-03-15', preavisoOtorgado: true, fechaPago: '2026-03-31' })).body as { id: string };
    jest.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    expect((await x.http.post('/api/sueldos/ganancias/anual/2025/calcular')).status).toBe(201);
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar');
    expect([r.status, r.body.message]).toEqual([400, 'Cierre primero las liquidaciones finales pendientes de los egresos de enero a marzo de 2026']);
    await x.cerrar(f.id);
    expect((await x.http.post('/api/sueldos/ganancias/anual/2025/cerrar')).status).toBe(201);
    expect(await prisma.liquidacionAnualGananciasEmpleado.count({ where: { empleadoId: x.e.id, distracto: true } })).toBe(1);
  });

  it('egreso de marzo con la final pagada después del cierre de la anual: ajuste en la final', async () => {
    const x = await escenario(1000000);
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-03-20', preavisoOtorgado: true, fechaPago: '2026-11-10' })).body as { id: string };
    expect(x.r561(await x.recibo(f.id))!.importe).toBe('1000000.00');
  });

  it('devolución sin tope', async () => {
    const x = await escenario(-5000000);
    const nov = await x.crear('MENSUAL', 2026, 11);
    const r = await x.recibo(nov.id);
    expect(x.r561(r)!.importe).toBe('-5000000.00');
  });

  it('no cuenta en el año nuevo', async () => {
    const x = await escenario(1000000);
    const nov = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(nov.id);
    const retNov = x.r560(await x.recibo(nov.id));
    const dic = await x.crear('MENSUAL', 2026, 12);
    expect((await x.recibo(dic.id)).hojaGanancias!.retenidoAnterior).toBe(retNov.toFixed(2));
  });

  it('reabrir la liquidación lo deja pendiente', async () => {
    const x = await escenario(1000000);
    const nov = await x.crear('MENSUAL', 2026, 11);
    await x.cerrar(nov.id);
    expect((await x.http.post(`/api/sueldos/liquidaciones/${nov.id}/reabrir`)).status).toBe(201);
    const dic = await x.crear('MENSUAL', 2026, 12);
    expect(x.r561(await x.recibo(dic.id))!.importe).toBe('1000000.00');
  });

  it('no se reabre la anual con ajuste aplicado', async () => {
    const x = await escenario(1000000);
    await x.cerrar((await x.crear('MENSUAL', 2026, 11)).id);
    const r = await x.http.post('/api/sueldos/ganancias/anual/2025/reabrir');
    expect([r.status, r.body.message]).toEqual([400, 'El ajuste anual ya se aplicó en una liquidación cerrada: no se puede reabrir']);
  });

  it('antes del cierre de la anual no hay ajuste', async () => {
    const x = await escenario(null);
    const nov = await x.crear('MENSUAL', 2026, 11);
    expect(x.r561(await x.recibo(nov.id))).toBeUndefined();
  });

  it('distracto en la final de febrero', async () => {
    const x = await escenario(null);
    // Retenciones de 2025 hechas fuera del sistema: la anual 2025 del empleado da devolución
    expect((await x.http.put(`/api/sueldos/ganancias/acumulado/${x.e.id}/2025`, { bruta: 0, aportes: 0, retenido: 500000 })).status).toBe(200);
    jest.setSystemTime(new Date('2026-02-20T15:00:00Z'));
    const f = (await x.http.post('/api/sueldos/egresos', { empleadoId: x.e.id, causa: 'RENUNCIA', fechaEgreso: '2026-02-15', preavisoOtorgado: true, fechaPago: '2026-02-20' })).body as { id: string };
    const r = await x.recibo(f.id);
    const ajuste = x.r561(r);
    expect(ajuste).toBeDefined();
    const renglon = await prisma.reciboSueldoRenglon.findFirstOrThrow({ where: { codigo: '561', recibo: { liquidacionId: f.id } } });
    expect(renglon.anioAjusteGanancias).toBe(2025);
    await x.cerrar(f.id);
    const fila = await prisma.liquidacionAnualGananciasEmpleado.findFirstOrThrow({ where: { empleadoId: x.e.id, distracto: true } });
    expect(fila.liquidacionFinalId).toBe(f.id);
    // Devolución: el ajuste de la final es el saldo de la anual del año anterior, sin tope
    expect(fila.saldo.lt(0)).toBe(true);
    expect(D(ajuste!.importe).toFixed(2)).toBe(fila.saldo.toFixed(2));
    expect((await x.http.post(`/api/sueldos/liquidaciones/${f.id}/reabrir`)).status).toBe(201);
    expect(await prisma.liquidacionAnualGananciasEmpleado.count({ where: { empleadoId: x.e.id, distracto: true } })).toBe(0);
  });
});
