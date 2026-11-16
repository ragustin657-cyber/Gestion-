import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

type Recibo = { empleadoId: string; numero: number | null; neto: string; renglones: { codigo: string; importe: string }[] };
type Liq = { estado: string; recibos: Recibo[]; aviso?: string; egreso: { causa: string; fechaEgreso: string } | null };

describe('sueldos: dar de baja', () => {
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
    await s.escala('Vendedor B', '2026-10', 1000000);
    const e = await s.empleado();
    const mensual = async (mes: number) => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes, fechaPago: `2026-${mes}-28` })).body as { id: string };
    const ver = async (id: string) => (await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body as Liq;
    const baja = (d: Record<string, unknown> = {}) => s.http.post('/api/sueldos/egresos', { empleadoId: e.id, causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19', ...d });
    const importe = (l: Liq, codigo: string) => l.recibos[0]?.renglones.find((r) => r.codigo === codigo)?.importe;
    return { ...s, e, mensual, ver, baja, importe };
  };

  it('dar de baja', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    await x.http.put(`/api/sueldos/liquidaciones/${m.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    const r = await x.baja();
    expect(r.status).toBe(201);
    const f = await x.ver(r.body.id);
    expect(f.egreso).toMatchObject({ causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15' });
    expect(x.importe(f, '300')).toBe('6824790.00');
    expect(x.importe(f, '130')).toBeDefined();
    const mv = await x.ver(m.id);
    expect(mv.recibos.find((y) => y.empleadoId === x.e.id)).toBeUndefined();
    expect(await prisma.novedad.count({ where: { liquidacionId: m.id } })).toBe(0);
    const emp = await prisma.empleado.findUniqueOrThrow({ where: { id: x.e.id } });
    expect([emp.fechaEgreso?.toISOString().slice(0, 10), emp.activo]).toEqual(['2026-11-15', false]);
    expect((await x.http.get('/api/sueldos/liquidaciones')).body.find((l: { id: string }) => l.id === r.body.id).empleado).toMatchObject({ legajo: 1 });
  });

  it('no se da de baja dos veces', async () => {
    const x = await escenario();
    await x.baja();
    expect((await x.baja()).body.message).toBe('El empleado ya tiene una liquidación final');
    expect((await x.http.post('/api/sueldos/liquidaciones', { tipo: 'FINAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).status).toBe(400);
  });

  it('mensual cerrada posterior', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const r = await x.baja({ fechaEgreso: '2026-10-20' });
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación mensual de 11/2026 ya incluye al empleado: reábrala antes de darlo de baja']);
    expect(await prisma.egresoEmpleado.count({ where: { empresaId: x.empresaId } })).toBe(0);
    expect((await prisma.empleado.findUniqueOrThrow({ where: { id: x.e.id } })).fechaEgreso).toBeNull();
  });

  it('mensual reabierta', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/reabrir`);
    expect((await x.ver(m.id)).recibos[0].numero).not.toBeNull();
    expect((await x.baja()).status).toBe(201);
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/recalcular`);
    expect((await x.ver(m.id)).recibos.find((y) => y.empleadoId === x.e.id)).toBeUndefined();
  });

  it('eliminar la final', async () => {
    const x = await escenario();
    const m = await x.mensual(11);
    const f = (await x.baja()).body as { id: string };
    expect((await x.http.delete(`/api/sueldos/liquidaciones/${f.id}`)).status).toBe(200);
    const emp = await prisma.empleado.findUniqueOrThrow({ where: { id: x.e.id } });
    expect([emp.fechaEgreso, emp.activo]).toEqual([null, true]);
    expect((await x.ver(m.id)).recibos.map((y) => y.empleadoId)).toEqual([x.e.id]);
  });

  it('modificar el egreso', async () => {
    const x = await escenario();
    const f = (await x.baja()).body as { id: string };
    expect((await x.http.put(`/api/sueldos/egresos/${f.id}`, { causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: true, fechaPago: '2026-11-20' })).status).toBe(200);
    const v = await x.ver(f.id);
    expect([x.importe(v, '310'), x.importe(v, '320')]).toEqual([undefined, undefined]);
    const r = await x.http.put(`/api/sueldos/egresos/${f.id}`, { causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-12-01', preavisoOtorgado: true, fechaPago: '2026-12-04' });
    expect(r.body.message).toBe('Para cambiar el mes del egreso, elimine la liquidación final y vuelva a darlo de baja');
  });

  it('mejor remuneración de un recibo cerrado', async () => {
    const x = await escenario();
    const oct = await x.mensual(10);
    await x.http.put(`/api/sueldos/liquidaciones/${oct.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 10 }] });
    await x.http.post(`/api/sueldos/liquidaciones/${oct.id}/cerrar`);
    const remOct = (await prisma.reciboSueldo.findFirstOrThrow({ where: { liquidacionId: oct.id } })).totalRemunerativo;
    const f = (await x.baja()).body as { id: string };
    expect(x.importe(await x.ver(f.id), '300')).toBe(remOct.times(6).toFixed(2));
  });

  it('tope del convenio', async () => {
    const x = await escenario();
    await x.http.put('/api/sueldos/topes', { convenioId: x.convenio.id, desdeAnio: 2026, desdeMes: 7, importe: 900000 });
    const f = (await x.baja()).body as { id: string };
    expect(x.importe(await x.ver(f.id), '300')).toBe('5400000.00');
  });

  it('fecha de egreso desde la ficha', async () => {
    const x = await escenario();
    await x.baja();
    const r = await x.http.put(`/api/sueldos/empleados/${x.e.id}`, { fechaEgreso: '2026-11-20' });
    expect([r.status, r.body.message]).toEqual([400, 'La fecha de egreso se cambia desde la liquidación final']);
  });
});
