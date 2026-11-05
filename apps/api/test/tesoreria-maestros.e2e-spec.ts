import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesionConPlan } from './helpers';

describe('maestros de tesorería', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conBanco() {
    const s = await sesionConPlan(app, prisma);
    const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco de la Nación Argentina', codigoBcra: '011' })).body;
    return { ...s, banco };
  }

  it('crea cuenta bancaria con CBU válido', async () => {
    const { http, banco, cuenta } = await conBanco();
    const r = await http.post('/api/tesoreria/cuentas-bancarias', {
      bancoId: banco.id, numero: '123456/7', cbu: '0110599500000001234565', monedaCodigo: 'ARS',
      cuentaContableId: await cuenta('1.1.01.002'),
    });
    expect(r.status).toBe(201);
    expect((await http.get('/api/tesoreria/cuentas-bancarias')).body).toHaveLength(1);
  });

  it('CBU inválido → 400', async () => {
    const { http, banco, cuenta } = await conBanco();
    const r = await http.post('/api/tesoreria/cuentas-bancarias', {
      bancoId: banco.id, numero: '1', cbu: '0110599500000001234564', monedaCodigo: 'ARS',
      cuentaContableId: await cuenta('1.1.01.002'),
    });
    expect(r.status).toBe(400);
    expect(r.body.campos.cbu).toBe('CBU inválido');
  });

  it('cuenta contable no imputable → 400', async () => {
    const { http, banco, cuenta } = await conBanco();
    const r = await http.post('/api/tesoreria/cuentas-bancarias', {
      bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01'),
    });
    expect(r.status).toBe(400);
  });

  it('banco de otra empresa → 404', async () => {
    const a = await conBanco();
    const b = await sesionConPlan(app, prisma);
    const r = await b.http.post('/api/tesoreria/cuentas-bancarias', {
      bancoId: a.banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await b.cuenta('1.1.01.002'),
    });
    expect(r.status).toBe(404);
  });

  it('chequera física con desde > hasta → 400; e-cheq sin rango OK', async () => {
    const { http, banco, cuenta } = await conBanco();
    const cb = (await http.post('/api/tesoreria/cuentas-bancarias', {
      bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.002'),
    })).body;
    const mala = await http.post('/api/tesoreria/chequeras', { cuentaBancariaId: cb.id, tipo: 'FISICA', desde: 100, hasta: 50 });
    expect(mala.status).toBe(400);
    const sinRango = await http.post('/api/tesoreria/chequeras', { cuentaBancariaId: cb.id, tipo: 'FISICA' });
    expect(sinRango.status).toBe(400);
    const buena = await http.post('/api/tesoreria/chequeras', { cuentaBancariaId: cb.id, tipo: 'FISICA', desde: 1, hasta: 50 });
    expect(buena.status).toBe(201);
    expect(buena.body.proximoNumero).toBe(1);
    expect((await http.post('/api/tesoreria/chequeras', { cuentaBancariaId: cb.id, tipo: 'ECHEQ' })).status).toBe(201);
  });

  it('cajas', async () => {
    const { http, cuenta } = await conBanco();
    const r = await http.post('/api/tesoreria/cajas', { nombre: 'Caja principal', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.001') });
    expect(r.status).toBe(201);
    expect((await http.patch(`/api/tesoreria/cajas/${r.body.id}`, { activa: false })).body.activa).toBe(false);
  });
});
