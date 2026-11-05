import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PLAN_CUENTAS_MODELO } from '../src/seed/plan-cuentas-modelo';
import { conToken, crearApp, limpiarBase, loginComo, sesion } from './helpers';

describe('plan de cuentas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  /** Empresa creada por API (carga el plan modelo) y sesión de su administrador. */
  async function empresaConPlan() {
    const s = await sesion(app, prisma, { superadmin: true });
    const e = await s.http.post('/api/empresas', {
      razonSocial: 'Con Plan SA', cuit: '30-71234567-1', condicionIva: 'RESPONSABLE_INSCRIPTO',
    });
    const token = await loginComo(app, s.usuario.email, s.password, e.body.id);
    return { empresaId: e.body.id as string, http: conToken(app, token) };
  }

  const buscar = async (http: ReturnType<typeof conToken>, codigo: string) =>
    (await prisma.cuentaContable.findFirst({ where: { codigo, empresa: { razonSocial: 'Con Plan SA' } } }))!;

  it('al crear la empresa se carga el plan modelo como árbol', async () => {
    const { empresaId, http } = await empresaConPlan();
    expect(await prisma.cuentaContable.count({ where: { empresaId } })).toBe(PLAN_CUENTAS_MODELO.length);
    const r = await http.get('/api/plan-cuentas');
    expect(r.status).toBe(200);
    expect(r.body.map((n: { codigo: string }) => n.codigo)).toEqual(['1', '2', '3', '4', '5']);
    expect(r.body[0].hijos[0].codigo).toBe('1.1');
  });

  it('el modelo incluye las cuentas imputables clave', () => {
    const imputables = PLAN_CUENTAS_MODELO.filter((c) => c.imputable).map((c) => c.nombre);
    for (const n of ['Caja', 'IVA Crédito Fiscal', 'Proveedores', 'Retenciones Ganancias a depositar', 'Gastos bancarios'])
      expect(imputables).toContain(n);
  });

  it('alta de subcuenta hereda el tipo del padre', async () => {
    const { http } = await empresaConPlan();
    const padre = await buscar(http, '1.1.01');
    const r = await http.post('/api/plan-cuentas', { codigo: '1.1.01.010', nombre: 'Banco Galicia', padreId: padre.id, imputable: true });
    expect(r.status).toBe(201);
    expect(r.body.tipo).toBe('ACTIVO');
  });

  it('padre imputable → 400', async () => {
    const { http } = await empresaConPlan();
    const caja = await buscar(http, '1.1.01.001');
    const r = await http.post('/api/plan-cuentas', { codigo: '1.1.01.001.01', nombre: 'X', padreId: caja.id, imputable: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('La cuenta padre no admite subcuentas');
  });

  it('código que no empieza con el del padre → 400', async () => {
    const { http } = await empresaConPlan();
    const padre = await buscar(http, '1.1.01');
    const r = await http.post('/api/plan-cuentas', { codigo: '2.9', nombre: 'X', padreId: padre.id, imputable: true });
    expect(r.status).toBe(400);
  });

  it('código duplicado → 409', async () => {
    const { http } = await empresaConPlan();
    const padre = await buscar(http, '1.1.01');
    const r = await http.post('/api/plan-cuentas', { codigo: '1.1.01.001', nombre: 'Otra caja', padreId: padre.id, imputable: true });
    expect(r.status).toBe(409);
  });

  it('cuenta con hijos no puede pasar a imputable', async () => {
    const { http } = await empresaConPlan();
    const padre = await buscar(http, '1.1.01');
    const r = await http.patch(`/api/plan-cuentas/${padre.id}`, { imputable: true });
    expect(r.status).toBe(400);
  });

  it('otra empresa no ve el plan', async () => {
    await empresaConPlan();
    const { http } = await sesion(app, prisma, { permisos: ['plancuentas.ver'] });
    expect((await http.get('/api/plan-cuentas')).body).toEqual([]);
  });
});
