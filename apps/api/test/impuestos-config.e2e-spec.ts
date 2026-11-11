import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('impuestos: configuración, IIBB del proveedor y permisos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('valores por defecto y modificación', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    expect((await http.get('/api/impuestos/config')).body).toMatchObject({ arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' });
    expect((await http.put('/api/impuestos/config', { arbaActividad: '6', arbaSucursal: 2, arbaPeriodicidad: 'QUINCENAL', agipCodigoNorma: '029' })).status).toBe(200);
    expect((await http.get('/api/impuestos/config')).body).toMatchObject({ arbaPeriodicidad: 'QUINCENAL', arbaSucursal: 2 });
    const ver = await otroUsuario(app, prisma, empresaId, ['impuestos.ver']);
    expect((await ver.http.get('/api/impuestos/config')).status).toBe(200);
    expect((await ver.http.put('/api/impuestos/config', { arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' })).status).toBe(403);
    const rol = await prisma.rol.findFirstOrThrow({ where: { empresaId, nombre: 'Administrador' } });
    expect(rol.permisos).toEqual(expect.arrayContaining(['impuestos.ver', 'impuestos.presentar']));
  });

  it('situación y número de IIBB del proveedor', async () => {
    const { http, empresaId } = await sesionConPlan(app, prisma);
    const { proveedorId } = await datosCompras(prisma, empresaId);
    expect((await http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'CONVENIO', numeroIibb: '9011234567' })).status).toBe(200);
    expect((await http.get(`/api/terceros/${proveedorId}`)).body).toMatchObject({ situacionIibb: 'CONVENIO', numeroIibb: '9011234567' });
    expect((await http.patch(`/api/terceros/${proveedorId}`, { situacionIibb: 'OTRA' })).status).toBe(400);
  });
});
