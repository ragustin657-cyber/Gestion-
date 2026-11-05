import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, sesion } from './helpers';

describe('monedas y cotizaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const editor = () => sesion(app, prisma, { permisos: ['moneda.editar'] });

  it('lista ARS y USD', async () => {
    const { http } = await editor();
    const r = await http.get('/api/monedas');
    expect(r.body.map((m: { codigo: string }) => m.codigo)).toEqual(['ARS', 'USD']);
  });

  it('usa la última cotización anterior a la fecha', async () => {
    const { http } = await editor();
    await http.post('/api/cotizaciones', { monedaCodigo: 'USD', fecha: '2026-11-01', valor: 1400 });
    await http.post('/api/cotizaciones', { monedaCodigo: 'USD', fecha: '2026-11-04', valor: 1450.5 });
    const r = await http.get('/api/cotizaciones/vigente?moneda=USD&fecha=2026-11-03');
    expect(r.status).toBe(200);
    expect(r.body.valor).toBe('1400');
    expect((await http.get('/api/cotizaciones/vigente?moneda=USD&fecha=2026-11-05')).body.valor).toBe('1450.5');
  });

  it('sin cotizaciones → 400 con mensaje', async () => {
    const { http } = await editor();
    const r = await http.get('/api/cotizaciones/vigente?moneda=USD&fecha=2026-11-05');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('No hay cotización de USD para el 05/11/2026');
  });

  it('ARS siempre vale 1', async () => {
    const { http } = await editor();
    expect((await http.get('/api/cotizaciones/vigente?moneda=ARS&fecha=2026-11-05')).body.valor).toBe('1');
  });

  it('cotización repetida para la misma fecha → 409', async () => {
    const { http } = await editor();
    await http.post('/api/cotizaciones', { monedaCodigo: 'USD', fecha: '2026-11-01', valor: 1400 });
    expect((await http.post('/api/cotizaciones', { monedaCodigo: 'USD', fecha: '2026-11-01', valor: 1 })).status).toBe(409);
  });

  it('cotizaciones aisladas por empresa', async () => {
    const a = await editor();
    await a.http.post('/api/cotizaciones', { monedaCodigo: 'USD', fecha: '2026-11-01', valor: 1400 });
    const b = await editor();
    expect((await b.http.get('/api/cotizaciones/vigente?moneda=USD&fecha=2026-11-05')).status).toBe(400);
  });
});
