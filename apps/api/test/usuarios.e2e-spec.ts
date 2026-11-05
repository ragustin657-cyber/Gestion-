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

describe('usuarios: revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('con usuario.administrar (sin rol.administrar) puede listar roles para el selector', async () => {
    const { http } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    expect((await http.get('/api/roles')).status).toBe(200);
    expect((await http.post('/api/roles', { nombre: 'X', permisos: [] })).status).toBe(403);
  });

  it('el usuario cambia su propia contraseña con la actual', async () => {
    const { http, usuario, empresa, password } = await sesion(app, prisma);
    expect((await http.patch('/api/auth/password', { actual: 'mala-clave-xx', nueva: 'nueva-clave-123' })).status).toBe(400);
    expect((await http.patch('/api/auth/password', { actual: password, nueva: 'nueva-clave-123' })).status).toBe(200);
    await expect(loginComo(app, usuario.email, password, empresa.id)).rejects.toThrow();
    expect(await loginComo(app, usuario.email, 'nueva-clave-123', empresa.id)).toBeTruthy();
  });

  it('el administrador blanquea la contraseña de un usuario de su empresa', async () => {
    const { http, rol, empresa } = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const u = (await http.post('/api/usuarios', { email: 'z@test.com', nombre: 'Z', password: 'clave-larga-1', rolId: rol.id })).body;
    expect((await http.patch(`/api/usuarios/${u.id}`, { password: 'blanqueada-123' })).status).toBe(200);
    expect(await loginComo(app, 'z@test.com', 'blanqueada-123', empresa.id)).toBeTruthy();
  });
});

describe('usuarios: blanqueo entre empresas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('no puede blanquear la contraseña de un usuario que también pertenece a otra empresa', async () => {
    const a = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    const b = await sesion(app, prisma, { permisos: ['usuario.administrar'] });
    await b.http.post('/api/usuarios', { email: a.usuario.email, nombre: 'x', password: 'irrelevante-1', rolId: b.rol.id });
    const r = await b.http.patch(`/api/usuarios/${a.usuario.id}`, { password: 'robada-12345' });
    expect(r.status).toBe(403);
    expect(await loginComo(app, a.usuario.email, a.password, a.empresa.id)).toBeTruthy();
  });
});
