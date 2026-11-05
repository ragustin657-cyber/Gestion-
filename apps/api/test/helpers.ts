import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

export async function crearApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configurarApp(app);
  await app.init();
  return app;
}

export async function limpiarBase(prisma: PrismaService) {
  const tablas: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' AND tablename <> 'Moneda'`,
  );
  if (tablas.length)
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tablas.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
    );
}

import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { Permiso } from '@gestion/shared';

let contador = 0;

export async function crearEmpresaYUsuario(
  prisma: PrismaService,
  opciones: { permisos?: Permiso[]; superadmin?: boolean } = {},
) {
  contador++;
  const password = 'clave-segura-123';
  const empresa = await prisma.empresa.create({
    data: {
      razonSocial: `Empresa ${contador}`,
      cuit: '30712345671',
      condicionIva: 'RESPONSABLE_INSCRIPTO',
    },
  });
  const rol = await prisma.rol.create({
    data: { empresaId: empresa.id, nombre: 'Rol test', permisos: opciones.permisos ?? [] },
  });
  const usuario = await prisma.usuario.create({
    data: {
      email: `usuario${contador}-${Date.now()}@test.com`,
      nombre: `Usuario ${contador}`,
      passwordHash: await hash(password),
      superadmin: opciones.superadmin ?? false,
    },
  });
  await prisma.usuarioEmpresa.create({
    data: { usuarioId: usuario.id, empresaId: empresa.id, rolId: rol.id },
  });
  return { empresa, usuario, rol, password };
}

export async function loginComo(
  app: INestApplication,
  email: string,
  password: string,
  empresaId?: string,
): Promise<string> {
  const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  if (login.status !== 200) throw new Error(`login falló: ${login.status}`);
  if (!empresaId) return login.body.token;
  const sel = await request(app.getHttpServer())
    .post('/api/auth/empresa')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ empresaId });
  if (sel.status !== 200) throw new Error(`selección de empresa falló: ${sel.status}`);
  return sel.body.token;
}

export function conToken(app: INestApplication, token: string) {
  const s = () => request(app.getHttpServer());
  const h = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => s().get(url).set(h),
    post: (url: string, body?: object) => s().post(url).set(h).send(body),
    patch: (url: string, body?: object) => s().patch(url).set(h).send(body),
    put: (url: string, body?: object) => s().put(url).set(h).send(body),
    delete: (url: string) => s().delete(url).set(h),
  };
}

/** Crea empresa + usuario con permisos y devuelve un cliente HTTP autenticado en esa empresa. */
export async function sesion(
  app: INestApplication,
  prisma: PrismaService,
  opciones: { permisos?: Permiso[]; superadmin?: boolean } = {},
) {
  const datos = await crearEmpresaYUsuario(prisma, opciones);
  const token = await loginComo(app, datos.usuario.email, datos.password, datos.empresa.id);
  return { ...datos, token, http: conToken(app, token) };
}
