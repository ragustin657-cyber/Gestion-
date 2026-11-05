import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, loginComo, sesion } from './helpers';

describe('usuarios', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('crea usuario en la empresa activa y puede ingresar a ella', async () => {
    const { http, empresa, rol } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const r = await http.post('/api/usuarios', {
      email: 'Nuevo@Test.com',
      nombre: 'Nuevo',
      password: 'otra-clave-123',
      rolId: rol.id,
    });
    expect(r.status).toBe(201);
    const token = await loginComo(app, 'nuevo@test.com', 'otra-clave-123', empresa.id);
    expect(token).toBeTruthy();
    const lista = await http.get('/api/usuarios');
    expect(lista.body.map((u: { email: string }) => u.email)).toContain('nuevo@test.com');
  });

  it('rol de otra empresa → 404', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const otra = await sesion(app, prisma);
    const r = await http.post('/api/usuarios', {
      email: 'x@test.com', nombre: 'X', password: 'clave-larga-1', rolId: otra.rol.id,
    });
    expect(r.status).toBe(404);
  });

  it('desactivar usuario en la empresa', async () => {
    const { http, rol } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const r = await http.post('/api/usuarios', {
      email: 'y@test.com', nombre: 'Y', password: 'clave-larga-1', rolId: rol.id,
    });
    const m = await http.patch(`/api/usuarios/${r.body.id}`, { activo: false });
    expect(m.status).toBe(200);
    await expect(loginComo(app, 'y@test.com', 'clave-larga-1', (await prisma.empresa.findFirst())!.id)).rejects.toThrow();
  });

  it('email inválido → 400 con detalle de campo', async () => {
    const { http, rol } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const r = await http.post('/api/usuarios', { email: 'no-es-mail', nombre: 'Y', password: 'clave-larga-1', rolId: rol.id });
    expect(r.status).toBe(400);
    expect(r.body.campos.email).toBe('Email inválido');
  });
});
