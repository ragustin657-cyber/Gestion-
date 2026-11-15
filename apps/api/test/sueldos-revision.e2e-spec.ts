import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

type Recibo = { empleadoId: string; numero: number | null; diasTrabajados: number; neto: string };

describe('sueldos: correcciones de la revisión', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await prepararSueldos(app, prisma);
    await s.escala('Vendedor B', '2026-11', 1000000);
    const ver = async (id: string) => (await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body as { recibos: Recibo[]; errores: { empleadoId: string; mensaje: string }[] };
    const nueva = async () => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    return { ...s, ver, nueva };
  };

  it('empleado dado de baja en el mes (inactivo con egreso) se liquida por sus días', async () => {
    const x = await escenario();
    const e = await x.empleado({ fechaEgreso: '2026-11-10', activo: false });
    const l = await x.nueva();
    expect((await x.ver(l.id)).recibos.find((r) => r.empleadoId === e.id)).toMatchObject({ diasTrabajados: 10 });
  });

  it('reabrir conserva el recibo numerado de un empleado que luego se dio de baja', async () => {
    const x = await escenario();
    const e = await x.empleado();
    const l = await x.nueva();
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    const antes = (await x.ver(l.id)).recibos.find((r) => r.empleadoId === e.id)!;
    expect(antes.numero).not.toBeNull();
    expect((await x.http.put(`/api/sueldos/empleados/${e.id}`, { fechaEgreso: '2026-10-31', activo: false })).status).toBe(200);
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`)).status).toBe(201);
    const despues = (await x.ver(l.id)).recibos.find((r) => r.empleadoId === e.id);
    expect(despues).toMatchObject({ numero: antes.numero, neto: antes.neto, diasTrabajados: 30 });
  });

  it('conceptos validados según su cálculo', async () => {
    const x = await escenario();
    const base = { codigo: '600', nombre: 'Cuota mutual', orden: 600 };
    const mal = async (d: Record<string, unknown>) => { const r = await x.http.post('/api/sueldos/conceptos', { ...base, ...d }); return [r.status, r.body.message]; };
    expect(await mal({ clase: 'DESCUENTO', tipo: 'PORCENTAJE', parametros: { pct: 2 } })).toEqual([400, 'El cálculo Porcentaje no admite la clase Descuento']);
    expect(await mal({ clase: 'REMUNERATIVO', tipo: 'DESCUENTO_LEY', parametros: { pct: 2 } })).toEqual([400, 'El cálculo Descuento de ley no admite la clase Remunerativo']);
    expect(await mal({ clase: 'NO_REMUNERATIVO', tipo: 'PORCENTAJE', parametros: { porcentaje: 8.33 } })).toEqual([400, 'Parámetro pct: debe ser un número mayor o igual a cero']);
    expect(await mal({ clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: '8,33' } })).toEqual([400, 'Parámetro pct: debe ser un número mayor o igual a cero']);
    expect(await mal({ clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 2, base: 'OTRA' } })).toEqual([400, 'Parámetro base inválido']);
    expect((await x.http.post('/api/sueldos/conceptos', { ...base, clase: 'DESCUENTO', tipo: 'FIJO', parametros: { importe: 5000 } })).status).toBe(201);
  });

  it('un concepto con parámetros inválidos grabados no rompe la liquidación', async () => {
    const x = await escenario();
    const e = await x.empleado();
    await prisma.concepto.updateMany({ where: { empresaId: x.empresaId, codigo: '120' }, data: { parametros: { pct: '8,33', base: 'BASICO_MAS_ANTIGUEDAD' } } });
    const l = await x.nueva();
    const r = await x.http.get(`/api/sueldos/liquidaciones/${l.id}`);
    expect(r.status).toBe(200);
    expect(r.body.errores).toEqual([{ empleadoId: e.id, mensaje: 'El concepto 120 Presentismo tiene parámetros inválidos: Parámetro pct: debe ser un número mayor o igual a cero' }]);
  });
});
