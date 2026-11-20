import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, crearEmpresaYUsuario, limpiarBase } from './helpers';

describe('seguridad: login', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterEach(() => jest.setSystemTime(new Date('2026-11-06T15:00:00Z')));
  afterAll(async () => app.close());

  const login = (email: string, password: string, ip = '10.0.0.1') => request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });

  it('5 fallidos bloquean el email 15 minutos, aun con la contraseña correcta', async () => {
    const { usuario, password } = await crearEmpresaYUsuario(prisma);
    for (let i = 0; i < 5; i++) expect((await login(usuario.email, 'mala')).status).toBe(401);
    const r = await login(usuario.email, password);
    expect([r.status, r.body.message]).toEqual([429, 'Demasiados intentos: espere unos minutos']);
    jest.setSystemTime(new Date('2026-11-06T15:16:00Z'));
    expect((await login(usuario.email, password)).status).toBe(200);
  });

  it('otro email desde otra IP no se bloquea', async () => {
    const a = await crearEmpresaYUsuario(prisma);
    const b = await crearEmpresaYUsuario(prisma);
    for (let i = 0; i < 5; i++) await login(a.usuario.email, 'mala', '10.0.0.2');
    expect((await login(b.usuario.email, b.password, '10.0.0.3')).status).toBe(200);
  });

  it('5 fallidos desde una IP bloquean esa IP', async () => {
    const { usuario, password } = await crearEmpresaYUsuario(prisma);
    for (let i = 0; i < 5; i++) await login(`nadie${i}@x.com`, 'mala', '10.0.0.4');
    expect((await login(usuario.email, password, '10.0.0.4')).status).toBe(429);
    expect((await login(usuario.email, password, '10.0.0.5')).status).toBe(200);
  });

  it('un login correcto borra los fallidos del email', async () => {
    const { usuario, password } = await crearEmpresaYUsuario(prisma);
    for (let i = 0; i < 4; i++) await login(usuario.email, 'mala', '10.0.0.6');
    expect((await login(usuario.email, password, '10.0.0.6')).status).toBe(200);
    expect(await prisma.intentoLogin.count({ where: { clave: `email:${usuario.email}` } })).toBe(0);
  });

  it('email inexistente: verifica contra un hash igual (tiempo parejo)', async () => {
    const espia = jest.spyOn(app.get(AuthService) as unknown as { hashFicticio: () => Promise<string> }, 'hashFicticio');
    await login('no-existe@x.com', 'algo', '10.0.0.7');
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });

  it('intentos en paralelo no superan el límite (revisión E36)', async () => {
    const { usuario } = await crearEmpresaYUsuario(prisma);
    const rs = await Promise.all(Array.from({ length: 12 }, () => login(usuario.email, 'mala', '10.0.0.8')));
    expect(rs.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(7);
  });
});
