import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { TODOS_LOS_PERMISOS } from '@gestion/shared';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('empresas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const nueva = { razonSocial: 'Nueva S.A.', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO' };

  it('superadmin crea empresa con rol Administrador y queda asignado', async () => {
    const { http, usuario } = await sesion(app, prisma, { superadmin: true });
    const r = await http.post('/api/empresas', nueva);
    expect(r.status).toBe(201);
    expect(r.body.cuit).toBe('30712345671');
    const acceso = await prisma.usuarioEmpresa.findUnique({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: r.body.id } },
      include: { rol: true },
    });
    expect(acceso?.rol.nombre).toBe('Administrador');
    expect(acceso?.rol.permisos.sort()).toEqual([...TODOS_LOS_PERMISOS].sort());
  });

  it('CUIT inválido → 400', async () => {
    const { http } = await sesion(app, prisma, { superadmin: true });
    const r = await http.post('/api/empresas', { ...nueva, cuit: '20-12345678-5' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('CUIT inválido');
  });

  it('no superadmin → 403', async () => {
    const { http } = await sesion(app, prisma, { permisos: TODOS_LOS_PERMISOS });
    expect((await http.post('/api/empresas', nueva)).status).toBe(403);
  });

  it('editar empresa actual y agentes de retención', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['empresa.administrar'] });
    const r = await http.patch('/api/empresas/actual', {
      domicilio: 'Av. Siempre Viva 123',
      agenteRetencionGanancias: true,
      jurisdiccionesIibb: ['901', '902'],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domicilio: 'Av. Siempre Viva 123', agenteRetencionGanancias: true, jurisdiccionesIibb: ['901', '902'] });
  });

  it('puntos de venta: alta y duplicado', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['empresa.administrar'] });
    expect((await http.post('/api/empresas/actual/puntos-venta', { numero: 1 })).status).toBe(201);
    expect((await http.post('/api/empresas/actual/puntos-venta', { numero: 1 })).status).toBe(409);
    const l = await http.get('/api/empresas/actual/puntos-venta');
    expect(l.body).toHaveLength(1);
  });
});
