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

/** Empresa creada por API (con plan de cuentas modelo) y cliente HTTP de su administrador. */
export async function sesionConPlan(app: INestApplication, prisma: PrismaService) {
  const s = await sesion(app, prisma, { superadmin: true });
  const e = await s.http.post('/api/empresas', {
    razonSocial: `Con Plan ${Date.now()}`, cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO',
  });
  const token = await loginComo(app, s.usuario.email, s.password, e.body.id);
  const http = conToken(app, token);
  const cuenta = async (codigo: string) =>
    (await prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: e.body.id, codigo } })).id;
  return { empresaId: e.body.id as string, http, cuenta };
}

/** Proveedor RI, artículo al 21 % y cotización USD 1000 al 2026-11-01 en la empresa indicada. */
export async function datosCompras(prisma: PrismaService, empresaId: string) {
  const n = await prisma.tercero.count({ where: { empresaId } });
  const proveedor = await prisma.tercero.create({
    data: { empresaId, codigo: n + 1, razonSocial: `Proveedor ${n + 1}`, cuit: n ? '30711223343' : '30700123452', condicionIva: 'RESPONSABLE_INSCRIPTO', esProveedor: true, diasPago: 30 },
  });
  const articulo = await prisma.articulo.create({
    data: { empresaId, codigo: `ART-${n + 1}`, descripcion: 'Artículo de prueba', unidad: 'UN', alicuotaIva: 21 },
  });
  await prisma.cotizacion.upsert({
    where: { empresaId_monedaCodigo_fecha: { empresaId, monedaCodigo: 'USD', fecha: new Date('2026-11-01T00:00:00Z') } },
    create: { empresaId, monedaCodigo: 'USD', fecha: new Date('2026-11-01T00:00:00Z'), valor: 1000 },
    update: {},
  });
  return { proveedorId: proveedor.id, articuloId: articulo.id };
}

/** Agrega a la empresa otro usuario con los permisos indicados y devuelve su cliente HTTP. */
export async function otroUsuario(app: INestApplication, prisma: PrismaService, empresaId: string, permisos: Permiso[]) {
  contador++;
  const password = 'clave-segura-123';
  const rol = await prisma.rol.create({ data: { empresaId, nombre: `Rol ${contador}`, permisos } });
  const usuario = await prisma.usuario.create({
    data: { email: `otro${contador}-${Date.now()}@test.com`, nombre: `Otro ${contador}`, passwordHash: await hash(password) },
  });
  await prisma.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId, rolId: rol.id } });
  const token = await loginComo(app, usuario.email, password, empresaId);
  return { usuario, http: conToken(app, token) };
}

/** Crea y confirma una OC aprobada automáticamente (sube el monto límite) y la devuelve. */
export async function ocAprobada(
  http: ReturnType<typeof conToken>, prisma: PrismaService, empresaId: string,
  d: { proveedorId: string; articuloId: string }, cantidad = 10, precio = 1000, monedaCodigo = 'ARS',
) {
  await prisma.empresa.update({ where: { id: empresaId }, data: { montoAprobacionOc: 1e12 } });
  const b = await http.post('/api/compras/ordenes', {
    terceroId: d.proveedorId, fecha: '2026-11-05', monedaCodigo,
    renglones: [{ articuloId: d.articuloId, descripcion: 'Artículo', cantidad, precioUnitario: precio, alicuotaIva: 21 }],
  });
  if (b.status !== 201) throw new Error(`alta OC: ${JSON.stringify(b.body)}`);
  const c = await http.post(`/api/compras/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
  if (c.body.estado !== 'APROBADA') throw new Error(`confirmar OC: ${JSON.stringify(c.body)}`);
  return c.body as { id: string; numero: number; version: number; renglones: { id: string }[] };
}
