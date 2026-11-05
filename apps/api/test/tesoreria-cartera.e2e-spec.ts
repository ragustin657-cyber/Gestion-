import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('cartera de cheques de terceros', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('el admin ve todos los cheques y el usuario de ROS solo los de su sucursal', async () => {
    const t = await prepararTesoreria(app, prisma);
    await t.ingresar({ cheques: [t.cheque(50000, { fechaPago: '2030-12-01' })] });
    await t.ingresar({ cajaId: t.cajaRos.id, cheques: [t.cheque(30000, { fechaPago: '2030-12-20', libradorNombre: 'Otro Librador' })] });
    const todos = (await t.http.get('/api/tesoreria/cheques')).body;
    expect(todos.total).toBe(2);
    expect(todos.totales).toEqual([{ monedaCodigo: 'ARS', importe: '80000' }]);
    expect(todos.items[0]).toMatchObject({ banco: 'Galicia', estado: 'EN_CARTERA', monedaCodigo: 'ARS' });
    expect(todos.items.map((c: { caja: { nombre: string; sucursal: string } }) => c.caja)).toEqual(
      expect.arrayContaining([{ id: t.cajaCen.id, nombre: 'Caja central', sucursal: 'Casa central' }, { id: t.cajaRos.id, nombre: 'Caja Rosario', sucursal: 'Sucursal Rosario' }]),
    );
    expect(todos.porSemana).toEqual([{ semana: '2030-11-25', monedaCodigo: 'ARS', importe: '50000' }, { semana: '2030-12-16', monedaCodigo: 'ARS', importe: '30000' }]);
    const ros = (await t.rosario.get('/api/tesoreria/cheques')).body;
    expect(ros.total).toBe(1);
    expect(ros.items[0].importe).toBe('30000');
  });

  it('filtros por estado, fecha de pago, caja y librador', async () => {
    const t = await prepararTesoreria(app, prisma);
    const a = await t.ingresar({ cheques: [t.cheque(100, { fechaPago: '2030-01-10' })] });
    await t.ingresar({ cheques: [t.cheque(200, { fechaPago: '2030-02-10', libradorNombre: 'Distribuidora Norte' })] });
    await t.http.post(`/api/tesoreria/ingresos/${a.id}/anular`, { motivo: 'x' });
    expect((await t.http.get('/api/tesoreria/cheques?estado=EN_CARTERA')).body.total).toBe(1);
    expect((await t.http.get('/api/tesoreria/cheques?estado=ANULADO')).body.total).toBe(1);
    expect((await t.http.get('/api/tesoreria/cheques?desde=2030-02-01&hasta=2030-02-28')).body.items[0].importe).toBe('200');
    expect((await t.http.get('/api/tesoreria/cheques?librador=norte')).body.total).toBe(1);
    expect((await t.http.get(`/api/tesoreria/cheques?cajaId=${t.cajaRos.id}`)).body.total).toBe(0);
    expect((await t.http.get(`/api/tesoreria/cheques?sucursalId=${t.cen.id}`)).body.total).toBe(2);
  });

  it('detalle con historial; cheque de otra empresa → 404; parámetros inválidos → 400', async () => {
    const t = await prepararTesoreria(app, prisma);
    const ing = await t.ingresar({ cheques: [t.cheque(100)] });
    const d = await t.http.get(`/api/tesoreria/cheques/${ing.cheques[0].id}`);
    expect(d.status).toBe(200);
    expect(d.body.historial).toHaveLength(1);
    expect(d.body.historial[0]).toMatchObject({ estadoAnterior: null, estadoNuevo: 'EN_CARTERA', caja: 'Caja central', origenTipo: 'INGRESO' });
    expect(d.body.historial[0].usuario).toBeTruthy();
    expect((await t.rosario.get(`/api/tesoreria/cheques/${ing.cheques[0].id}`)).status).toBe(404);
    const otra = await prepararTesoreria(app, prisma);
    expect((await otra.http.get(`/api/tesoreria/cheques/${ing.cheques[0].id}`)).status).toBe(404);
    expect((await t.http.get('/api/tesoreria/cheques?estado=XX')).status).toBe(400);
    expect((await t.http.get('/api/tesoreria/cheques?desde=2030-13-01')).status).toBe(400);
  });
});
