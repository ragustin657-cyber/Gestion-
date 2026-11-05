import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, crearEmpresaYUsuario, limpiarBase, loginComo } from './helpers';

describe('auth', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const http = () => request(app.getHttpServer());

  it('login correcto devuelve token y empresas del usuario', async () => {
    const { usuario, empresa, password } = await crearEmpresaYUsuario(prisma);
    const r = await http().post('/api/auth/login').send({ email: usuario.email, password });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.usuario).toEqual({ id: usuario.id, nombre: usuario.nombre });
    expect(r.body.empresas).toEqual([{ id: empresa.id, razonSocial: empresa.razonSocial }]);
  });

  it('contraseña incorrecta → 401', async () => {
    const { usuario } = await crearEmpresaYUsuario(prisma);
    const r = await http().post('/api/auth/login').send({ email: usuario.email, password: 'mala' });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe('Usuario o contraseña incorrectos');
  });

  it('seleccionar empresa devuelve permisos del rol', async () => {
    const { usuario, empresa, password } = await crearEmpresaYUsuario(prisma, {
      permisos: ['tercero.ver'],
    });
    const login = await http().post('/api/auth/login').send({ email: usuario.email, password });
    const r = await http()
      .post('/api/auth/empresa')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ empresaId: empresa.id });
    expect(r.status).toBe(200);
    expect(r.body.permisos).toEqual(['tercero.ver']);
    expect(r.body.empresa).toEqual({ id: empresa.id, razonSocial: empresa.razonSocial });
  });

  it('seleccionar empresa sin acceso → 403', async () => {
    const a = await crearEmpresaYUsuario(prisma);
    const b = await crearEmpresaYUsuario(prisma);
    const token = await loginComo(app, a.usuario.email, a.password);
    const r = await http()
      .post('/api/auth/empresa')
      .set('Authorization', `Bearer ${token}`)
      .send({ empresaId: b.empresa.id });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe('No tiene acceso a esta empresa');
  });

  it('ruta protegida sin token → 401', async () => {
    expect((await http().get('/api/auth/yo')).status).toBe(401);
  });

  it('ruta protegida con token de empresa devuelve el contexto', async () => {
    const { usuario, empresa, password } = await crearEmpresaYUsuario(prisma, {
      permisos: ['tercero.ver'],
    });
    const token = await loginComo(app, usuario.email, password, empresa.id);
    const r = await http().get('/api/auth/yo').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      usuarioId: usuario.id,
      empresaId: empresa.id,
      permisos: ['tercero.ver'],
      superadmin: false,
    });
  });

  it('acceso a empresa desactivado invalida el token → 401', async () => {
    const { usuario, empresa, password } = await crearEmpresaYUsuario(prisma);
    const token = await loginComo(app, usuario.email, password, empresa.id);
    await prisma.usuarioEmpresa.update({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } },
      data: { activo: false },
    });
    expect((await http().get('/api/auth/yo').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('usuario desactivado invalida el token → 401', async () => {
    const { usuario, empresa, password } = await crearEmpresaYUsuario(prisma);
    const token = await loginComo(app, usuario.email, password, empresa.id);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
    expect((await http().get('/api/auth/yo').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});
