import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararSueldos } from './helpers-sueldos';

describe('pulido 22: concurrencia, vacaciones y finales', () => {
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
    const mensual = async () => (await s.http.post('/api/sueldos/liquidaciones', { tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30' })).body as { id: string };
    const baja = (empleadoId: string) => s.http.post('/api/sueldos/egresos', { empleadoId, causa: 'RENUNCIA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' });
    return { ...s, e, mensual, baja };
  };

  it('dos consultas simultáneas de un borrador', async () => {
    const x = await escenario();
    const m = await x.mensual();
    const cat = await x.categoria('Vendedor B');
    const nuevo = await prisma.empleado.create({ data: { empresaId: x.empresaId, legajo: 99, apellido: 'Nuevo', nombre: 'Uno', cuil: '20123456786', domicilio: '', fechaIngreso: new Date('2021-03-01T00:00:00Z'), categoriaId: cat.id } });
    const rs = await Promise.all([x.http.get(`/api/sueldos/liquidaciones/${m.id}`), x.http.get(`/api/sueldos/liquidaciones/${m.id}`)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.reciboSueldo.count({ where: { liquidacionId: m.id, empleadoId: nuevo.id } })).toBe(1);
  });

  it('modificar y eliminar una final cerrada', async () => {
    const x = await escenario();
    const f = (await x.baja(x.e.id)).body as { id: string };
    await x.http.post(`/api/sueldos/liquidaciones/${f.id}/cerrar`);
    const put = await x.http.put(`/api/sueldos/egresos/${f.id}`, { causa: 'RENUNCIA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-20' });
    expect([put.status, put.body.message]).toEqual([400, 'La liquidación está cerrada']);
    expect((await x.http.delete(`/api/sueldos/liquidaciones/${f.id}`)).status).toBe(400);
  });

  it('eliminar una final con la mensual cerrada', async () => {
    const x = await escenario();
    await x.empleado();
    const f = (await x.baja(x.e.id)).body as { id: string };
    const m = await x.mensual();
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const r = await x.http.delete(`/api/sueldos/liquidaciones/${f.id}`);
    expect([r.status, r.body.message]).toEqual([400, 'La liquidación mensual de 11/2026 ya está cerrada: el empleado quedaría sin recibo de ese mes. Reábrala antes de eliminar la final']);
  });

  it('vacaciones con la final', async () => {
    const x = await escenario();
    await x.empleado();
    const f = (await x.baja(x.e.id)).body as { id: string };
    const m = await x.mensual();
    await x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`);
    const r = await x.http.post('/api/sueldos/vacaciones', { empleadoId: x.e.id, anio: 2026, desde: '2026-11-02', hasta: '2026-11-05' });
    expect(r.status).toBe(201);
    const fin = (await x.http.get(`/api/sueldos/liquidaciones/${f.id}`)).body.recibos[0].renglones.map((y: { codigo: string }) => y.codigo);
    expect(fin).toEqual(expect.arrayContaining(['150', '151']));
    await x.http.post(`/api/sueldos/liquidaciones/${f.id}/cerrar`);
    const r2 = await x.http.post('/api/sueldos/vacaciones', { empleadoId: x.e.id, anio: 2026, desde: '2026-11-07', hasta: '2026-11-08' });
    expect([r2.status, r2.body.message]).toEqual([400, 'La liquidación final de 11/2026 ya está cerrada: marque el período como liquidado fuera del sistema o reábrala']);
  });

  it('período y cierre simultáneos', async () => {
    const x = await escenario();
    const m = await x.mensual();
    const [alta] = await Promise.all([
      x.http.post('/api/sueldos/vacaciones', { empleadoId: x.e.id, anio: 2026, desde: '2026-11-09', hasta: '2026-11-22' }),
      x.http.post(`/api/sueldos/liquidaciones/${m.id}/cerrar`),
    ]);
    if (alta.status === 201) {
      const p = await prisma.vacacionPeriodo.findUniqueOrThrow({ where: { id: alta.body.id } });
      const pagado = await prisma.reciboSueldoRenglon.count({ where: { vacacionPeriodoId: p.id } });
      expect(pagado).toBe(2);
    } else expect(alta.status).toBe(400);
  });
});
