import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { PrismaService } from '../src/prisma/prisma.service';
import { conToken, crearApp, limpiarBase, loginComo, sesionConPlan } from './helpers';

describe('sucursales y usuarios por sucursal', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('una empresa nueva tiene la casa central CEN; alta de ROS y código repetido 409', async () => {
    const s = await sesionConPlan(app, prisma);
    const lista = (await s.http.get('/api/tesoreria/sucursales')).body;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ codigo: 'CEN', nombre: 'Casa central', esCentral: true, activa: true });
    const ros = await s.http.post('/api/tesoreria/sucursales', { codigo: 'ROS', nombre: 'Sucursal Rosario' });
    expect(ros.status).toBe(201);
    expect(ros.body.esCentral).toBe(false);
    expect((await s.http.post('/api/tesoreria/sucursales', { codigo: 'ROS', nombre: 'Otra' })).status).toBe(409);
  });

  it('la empresa tiene las cuentas y conceptos nuevos de tesorería', async () => {
    const s = await sesionConPlan(app, prisma);
    for (const codigo of ['1.1.01.004', '1.1.01.005', '1.1.02.002', '5.2.04']) await s.cuenta(codigo);
    const conceptos = await prisma.configCuenta.findMany({ where: { empresaId: s.empresaId } });
    const nombres = conceptos.map((c) => c.concepto);
    for (const c of ['VALORES_A_DEPOSITAR', 'TRANSFERENCIAS_A_ACREDITAR', 'VALORES_EN_TRANSITO', 'DEUDORES_POR_VENTAS', 'CHEQUES_RECHAZADOS', 'GASTOS_BANCARIOS', 'DIFERENCIAS_DE_CAJA'])
      expect(nombres).toContain(c);
    const rol = await prisma.rol.findFirstOrThrow({ where: { empresaId: s.empresaId, nombre: 'Administrador' } });
    expect(rol.permisos).toEqual(expect.arrayContaining(['tesoreria.ver', 'tesoreria.operar', 'tesoreria.aceptar', 'tesoreria.anular']));
  });

  it('una caja sin sucursal queda en la central; sucursal de otra empresa → 404', async () => {
    const s = await sesionConPlan(app, prisma);
    const otra = await sesionConPlan(app, prisma);
    const ajena = (await otra.http.get('/api/tesoreria/sucursales')).body[0];
    const central = (await s.http.get('/api/tesoreria/sucursales')).body[0];
    const caja = await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja', monedaCodigo: 'ARS', cuentaContableId: await s.cuenta('1.1.01.001') });
    expect(caja.status).toBe(201);
    expect(caja.body.sucursalId).toBe(central.id);
    const mala = await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja 2', monedaCodigo: 'ARS', cuentaContableId: await s.cuenta('1.1.01.001'), sucursalId: ajena.id });
    expect(mala.status).toBe(404);
  });

  it('usuario asignado a ROS: lo informa /auth/yo y solo ve las cajas de su sucursal', async () => {
    const s = await sesionConPlan(app, prisma);
    const ros = (await s.http.post('/api/tesoreria/sucursales', { codigo: 'ROS', nombre: 'Sucursal Rosario' })).body;
    const cta = await s.cuenta('1.1.01.001');
    await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja central', monedaCodigo: 'ARS', cuentaContableId: cta });
    await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja Rosario', monedaCodigo: 'ARS', cuentaContableId: cta, sucursalId: ros.id });
    const rol = (await s.http.post('/api/roles', { nombre: 'Cajero', permisos: ['tesoreria.ver', 'tesoreria.operar'] })).body;
    const alta = await s.http.post('/api/usuarios', { email: 'cajero@test.com', nombre: 'Cajero', password: 'clave-segura-123', rolId: rol.id, sucursalId: ros.id });
    expect(alta.status).toBe(201);
    expect(alta.body.sucursalId).toBe(ros.id);
    const token = await loginComo(app, 'cajero@test.com', 'clave-segura-123', s.empresaId);
    const cajero = conToken(app, token);
    expect((await cajero.get('/api/auth/yo')).body.sucursalId).toBe(ros.id);
    const cajas = (await cajero.get('/api/tesoreria/cajas')).body;
    expect(cajas.map((c: { nombre: string }) => c.nombre)).toEqual(['Caja Rosario']);
    expect((await s.http.get('/api/tesoreria/cajas')).body).toHaveLength(2);
    // Quitar la sucursal (null = todas)
    const mod = await s.http.patch(`/api/usuarios/${alta.body.id}`, { sucursalId: null });
    expect(mod.body.sucursalId).toBeNull();
  });

  it('asignar una sucursal de otra empresa a un usuario → 404', async () => {
    const s = await sesionConPlan(app, prisma);
    const otra = await sesionConPlan(app, prisma);
    const ajena = (await otra.http.get('/api/tesoreria/sucursales')).body[0];
    const rol = (await s.http.post('/api/roles', { nombre: 'Cajero', permisos: [] })).body;
    const u = await prisma.usuario.create({ data: { email: 'x@test.com', nombre: 'X', passwordHash: await hash('clave-segura-123') } });
    await prisma.usuarioEmpresa.create({ data: { usuarioId: u.id, empresaId: s.empresaId, rolId: rol.id } });
    expect((await s.http.patch(`/api/usuarios/${u.id}`, { sucursalId: ajena.id })).status).toBe(404);
  });

  it('no se puede desactivar ni desmarcar la única casa central', async () => {
    const s = await sesionConPlan(app, prisma);
    const central = (await s.http.get('/api/tesoreria/sucursales')).body[0];
    const r = await s.http.patch(`/api/tesoreria/sucursales/${central.id}`, { activa: false });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La empresa debe tener una casa central');
    expect((await s.http.patch(`/api/tesoreria/sucursales/${central.id}`, { esCentral: false })).status).toBe(400);
    // Marcar otra como central desmarca la anterior
    const ros = (await s.http.post('/api/tesoreria/sucursales', { codigo: 'ROS', nombre: 'Rosario' })).body;
    expect((await s.http.patch(`/api/tesoreria/sucursales/${ros.id}`, { esCentral: true })).status).toBe(200);
    const lista = (await s.http.get('/api/tesoreria/sucursales')).body;
    expect(lista.filter((x: { esCentral: boolean }) => x.esCentral).map((x: { codigo: string }) => x.codigo)).toEqual(['ROS']);
  });
});
