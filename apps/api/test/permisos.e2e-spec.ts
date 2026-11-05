import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('permisos y roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('sin el permiso requerido → 403', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['tercero.ver'] });
    const r = await http.get('/api/roles');
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('No tiene permiso para realizar esta acción');
  });

  it('con el permiso → 200', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['rol.administrar'] });
    const r = await http.get('/api/roles');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('superadmin pasa sin permisos', async () => {
    const { http } = await sesion(app, prisma, { superadmin: true });
    expect((await http.get('/api/roles')).status).toBe(200);
  });

  it('crear rol con permiso desconocido → 400', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['rol.administrar'] });
    const r = await http.post('/api/roles', { nombre: 'Malo', permisos: ['inventado.x'] });
    expect(r.status).toBe(400);
  });

  it('crear rol registra auditoría', async () => {
    const { http, usuario, empresa } = await sesion(app, prisma, { permisos: ['rol.administrar'] });
    const r = await http.post('/api/roles', { nombre: 'Comprador', permisos: ['oc.crear'] });
    expect(r.status).toBe(201);
    const aud = await prisma.auditoria.findMany({ where: { entidad: 'Rol', entidadId: r.body.id } });
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ accion: 'CREAR', usuarioId: usuario.id, empresaId: empresa.id });
  });

  it('modificar rol actualiza permisos', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['rol.administrar'] });
    const r = await http.post('/api/roles', { nombre: 'Comprador', permisos: ['oc.crear'] });
    const m = await http.patch(`/api/roles/${r.body.id}`, { permisos: ['oc.crear', 'oc.aprobar'] });
    expect(m.status).toBe(200);
    expect(m.body.permisos).toEqual(['oc.crear', 'oc.aprobar']);
  });
});
