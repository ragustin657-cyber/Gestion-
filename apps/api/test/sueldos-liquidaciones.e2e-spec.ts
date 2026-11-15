import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

type Recibo = { empleadoId: string; numero: number | null; diasTrabajados: number; totalRemunerativo: string; totalDescuentos: string; neto: string; renglones: { codigo: string; importe: string }[] };

describe('sueldos: liquidaciones', () => {
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
    const e = await s.empleado();
    const crear = async (tipo: string, anio: number, mes: number) => {
      const r = await s.http.post('/api/sueldos/liquidaciones', { tipo, anio, mes, fechaPago: `${anio}-${String(mes).padStart(2, '0')}-28` });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string };
    };
    const ver = async (id: string) => (await s.http.get(`/api/sueldos/liquidaciones/${id}`)).body as { recibos: Recibo[]; errores: { empleadoId: string; mensaje: string }[]; aviso?: string; estado: string };
    const recibo = async (id: string, empleadoId = e.id) => (await ver(id)).recibos.find((r) => r.empleadoId === empleadoId)!;
    return { ...s, e, crear, ver, recibo };
  };

  it('liquida noviembre y recalcula con novedades', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    expect(await x.recibo(l.id)).toMatchObject({ totalRemunerativo: '1137465.00', totalDescuentos: '221805.68', neto: '915659.32', numero: null });
    const r = await x.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    expect(r.status).toBe(200);
    expect((await x.recibo(l.id)).neto).toBe('941016.82');
  });

  it('falta de escala bloquea el cierre', async () => {
    const x = await escenario();
    const otro = await x.empleado({ categoria: 'Vendedor A' });
    const l = await x.crear('MENSUAL', 2026, 11);
    expect((await x.ver(l.id)).errores).toEqual([{ empleadoId: otro.id, mensaje: 'Falta la escala de Vendedor A para 11/2026' }]);
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`)).body.message).toBe('Corrija los errores antes de cerrar la liquidación');
  });

  it('escala vigente más reciente', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 12);
    expect((await x.recibo(l.id)).renglones.find((r) => r.codigo === '100')!.importe).toBe('1000000.00');
  });

  it('cerrar numera y reabrir conserva', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`)).status).toBe(201);
    expect((await x.recibo(l.id)).numero).toBe(1);
    expect((await x.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: x.e.id, novedades: [] })).body.message).toBe('La liquidación está cerrada');
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`)).status).toBe(201);
    const otro = await x.empleado();
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/recalcular`);
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    expect([(await x.recibo(l.id)).numero, (await x.recibo(l.id, otro.id)).numero]).toEqual([1, 2]);
  });

  it('SAC de diciembre', async () => {
    const x = await escenario();
    const sinMensual = await x.http.post('/api/sueldos/liquidaciones', { tipo: 'SAC', anio: 2026, mes: 12, fechaPago: '2026-12-18' });
    expect(sinMensual.body.message).toBe('No hay liquidaciones mensuales cerradas en el semestre');
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.http.put(`/api/sueldos/liquidaciones/${l.id}/novedades`, { empleadoId: x.e.id, novedades: [{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }] });
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    const sac = await x.crear('SAC', 2026, 12);
    const v = await x.ver(sac.id);
    expect(v.recibos[0].renglones.find((r) => r.codigo === '200')!.importe).toBe('584482.50');
    expect(v.aviso).toBe('La liquidación mensual de 12/2026 no está cerrada: no se considera en la mejor remuneración');
  });

  it('no reabre una mensual usada por un SAC cerrado', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    const sac = await x.crear('SAC', 2026, 12);
    await x.http.post(`/api/sueldos/liquidaciones/${sac.id}/cerrar`);
    expect((await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`)).body.message).toBe('La liquidación se usó en el SAC de 12/2026: reábralo primero');
  });

  it('empleados que entran y salen', async () => {
    const x = await escenario();
    const nuevo = await x.empleado({ fechaIngreso: '2026-11-16' });
    const ido = await x.empleado({ fechaIngreso: '2020-01-01', fechaEgreso: '2026-10-31' });
    const l = await x.crear('MENSUAL', 2026, 11);
    const v = await x.ver(l.id);
    expect(v.recibos.find((r) => r.empleadoId === nuevo.id)!.diasTrabajados).toBe(15);
    expect(v.recibos.some((r) => r.empleadoId === ido.id)).toBe(false);
  });

  it('una por período y eliminar borrador', async () => {
    const x = await escenario();
    const l = await x.crear('MENSUAL', 2026, 11);
    expect((await x.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-28' })).body.message).toBe('Ya existe la liquidación mensual de 11/2026');
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/cerrar`);
    expect((await x.http.delete(`/api/sueldos/liquidaciones/${l.id}`)).body.message).toBe('Solo se elimina una liquidación en borrador');
    await x.http.post(`/api/sueldos/liquidaciones/${l.id}/reabrir`);
    expect((await x.http.delete(`/api/sueldos/liquidaciones/${l.id}`)).status).toBe(200);
  });
});
