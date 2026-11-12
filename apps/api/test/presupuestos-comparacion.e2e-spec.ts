import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPresupuestos } from './helpers-presupuestos';

type Fila = { clave: string; nombre: string; tipo: string; presupuesto: string; real: string; desvio: string; desvioPct: string | null; favorable: boolean; sinPresupuesto: boolean };

describe('presupuestos: comparación contra el Mayor', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Ejemplo del spec §7. */
  const escenario = async () => {
    const p = await prepararPresupuestos(app, prisma);
    const a = await p.crear('Original 2026');
    await p.linea(a.id, '4.1.01', { '2026-11': 1000000 });
    await p.linea(a.id, '5.2.01', { '2026-11': 200000 });
    await p.linea(a.id, '5.2.01', { '2026-11': 100000 }, 'ROS');
    await p.asiento('2026-11-05', [['1.1.01.002', 900000, 0], ['4.1.01', 0, 900000]]);
    await p.asiento('2026-11-05', [['5.2.01', 220000, 0], ['5.2.01', 120000, 0, 'ROS'], ['5.2.01', 15000, 0, 'COR'], ['1.1.01.002', 0, 355000]]);
    const comparar = async (q: string) => (await p.http.get(`/api/presupuestos/${a.id}/comparacion?${q}`)).body;
    return { ...p, a, comparar };
  };
  const nov = 'desde=2026-11&hasta=2026-11';

  it('por cuenta', async () => {
    const e = await escenario();
    const r = await e.comparar(`${nov}&agrupar=cuenta`);
    const fila = (n: string) => r.filas.find((f: Fila) => f.nombre.startsWith(n));
    expect(fila('4.1.01')).toMatchObject({ tipo: 'INGRESO', presupuesto: '1000000.00', real: '900000.00', desvio: '-100000.00', desvioPct: '-10.00', favorable: false });
    expect(fila('5.2.01')).toMatchObject({ tipo: 'EGRESO', presupuesto: '300000.00', real: '355000.00', desvio: '55000.00', favorable: false });
    expect(r.totales.resultado).toEqual({ presupuesto: '700000.00', real: '545000.00', desvio: '-155000.00', desvioPct: '-22.14' });
    expect(r.totales.ingresos).toMatchObject({ presupuesto: '1000000.00', real: '900000.00' });
    expect(r.totales.egresos).toMatchObject({ presupuesto: '300000.00', real: '355000.00' });
  });

  it('por centro y sin presupuestar', async () => {
    const e = await escenario();
    const r = await e.comparar(`${nov}&agrupar=centro`);
    const fila = (n: string) => r.filas.find((f: Fila) => f.nombre === n);
    expect(fila('Rosario')).toMatchObject({ tipo: 'RESULTADO', presupuesto: '-100000.00', real: '-120000.00', favorable: false });
    expect(fila('Córdoba')).toMatchObject({ presupuesto: '0.00', real: '-15000.00', sinPresupuesto: true });
    expect(fila('Sin centro')).toMatchObject({ presupuesto: '800000.00', real: '680000.00' });
    const ros = await e.comparar(`${nov}&agrupar=cuenta&centroCostoId=${e.centros.ROS}`);
    expect(ros.filas).toEqual([expect.objectContaining({ presupuesto: '100000.00', real: '120000.00', desvioPct: '20.00' })]);
    const cuenta = await e.comparar(`${nov}&agrupar=cuenta&centroCostoId=${e.centros.COR}`);
    expect(cuenta.filas).toEqual([expect.objectContaining({ presupuesto: '0.00', real: '15000.00', desvioPct: null, sinPresupuesto: true })]);
  });

  it('por rubro', async () => {
    const e = await escenario();
    const r = await e.comparar(`${nov}&agrupar=rubro`);
    expect(r.filas.map((f: Fila) => [f.clave, f.presupuesto, f.real])).toEqual([['4.1', '1000000.00', '900000.00'], ['5.2', '300000.00', '355000.00']]);
  });

  it('excluye el ajuste por inflación', async () => {
    const e = await escenario();
    const ren = async (codigo: string, debe: number, haber: number) => ({ empresaId: e.empresaId, cuentaContableId: await e.cuenta(codigo), debe, haber });
    await prisma.asiento.create({ data: { empresaId: e.empresaId, numero: 9001, fecha: new Date('2026-11-30T00:00:00Z'), descripcion: 'Ajuste', origenTipo: 'AJUSTE_INFLACION', origenId: e.ejercicio.id, creadoPor: 't', tipo: 'AJUSTE_INFLACION', ejercicioId: e.ejercicio.id,
      renglones: { create: [await ren('4.1.01', 0, 50000), await ren('4.2.03', 50000, 0)] } } });
    expect((await e.comparar(`${nov}&agrupar=cuenta`)).totales.ingresos.real).toBe('900000.00');
  });

  it('valida el rango', async () => {
    const e = await escenario();
    const r = await e.http.get(`/api/presupuestos/${e.a.id}/comparacion?desde=2026-12&hasta=2026-11`);
    expect([r.status, r.body.message]).toEqual([400, 'El mes desde no puede ser posterior al mes hasta']);
    const f = await e.http.get(`/api/presupuestos/${e.a.id}/comparacion?desde=2026-11&hasta=2027-01`);
    expect([f.status, f.body.message]).toEqual([400, 'El mes 01/2027 no pertenece al ejercicio']);
    const def = await e.comparar('');
    expect([def.desde, def.hasta, def.agrupar]).toEqual(['2026-01', '2026-11', 'cuenta']);
  });

  it('serie y exportación', async () => {
    const e = await escenario();
    expect((await e.comparar('desde=2026-10&hasta=2026-11')).serie).toEqual([{ mes: '2026-10', presupuesto: '0.00', real: '0.00' }, { mes: '2026-11', presupuesto: '700000.00', real: '545000.00' }]);
    const bin = (url: string) => e.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((await bin(`/api/presupuestos/${e.a.id}/comparacion?${nov}&formato=xlsx`)).headers['content-type']).toContain('spreadsheetml');
    expect((await bin(`/api/presupuestos/${e.a.id}/comparacion?${nov}&formato=pdf`)).headers['content-type']).toContain('pdf');
  });
});
