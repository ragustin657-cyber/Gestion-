import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario, sesionConPlan } from './helpers';

describe('tarjetas: maestro', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const s = await sesionConPlan(app, prisma);
    const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
    const cuentaBanco = await s.cuenta('1.1.01.002');
    const ars = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: cuentaBanco })).body as { id: string };
    const usd = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '2', monedaCodigo: 'USD', cuentaContableId: cuentaBanco })).body as { id: string };
    return { ...s, ars, usd };
  };

  it('alta de tarjeta', async () => {
    const x = await escenario();
    const r = await x.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: x.ars.id });
    expect(r.status).toBe(201);
    expect(r.body.cuentaContableId).toBe(await x.cuenta('1.1.02.003'));
    const usd = await x.http.post('/api/tesoreria/tarjetas', { nombre: 'Amex', tipo: 'CREDITO', cuentaBancariaId: x.usd.id });
    expect([usd.status, usd.body.message]).toEqual([400, 'La cuenta bancaria debe ser en pesos']);
    expect((await x.http.post('/api/tesoreria/tarjetas', { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: x.ars.id })).status).toBeGreaterThanOrEqual(400);
    expect((await x.http.get('/api/tesoreria/tarjetas')).body).toHaveLength(1);
    expect((await x.http.put(`/api/tesoreria/tarjetas/${r.body.id}`, { nombre: 'Visa crédito', tipo: 'CREDITO', cuentaBancariaId: x.ars.id, activa: false })).status).toBe(200);
  });

  it('empresa nueva trae las cuentas y la configuración', async () => {
    const x = await escenario();
    for (const [c, codigo] of [['TARJETAS_A_COBRAR', '1.1.02.003'], ['COMISIONES_TARJETA', '5.2.12']]) {
      const cfg = await prisma.configCuenta.findFirstOrThrow({ where: { empresaId: x.empresaId, concepto: c } });
      expect(cfg.cuentaContableId).toBe(await x.cuenta(codigo));
    }
  });

  it('permisos', async () => {
    const x = await escenario();
    const u = await otroUsuario(app, prisma, x.empresaId, ['tesoreria.ver']);
    expect((await u.http.get('/api/tesoreria/tarjetas')).status).toBe(200);
    expect((await u.http.post('/api/tesoreria/tarjetas', { nombre: 'X', tipo: 'QR', cuentaBancariaId: x.ars.id })).status).toBe(403);
  });
});
