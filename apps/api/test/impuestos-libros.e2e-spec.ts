import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { periodoConMovimientos } from './helpers-impuestos';

describe('libros IVA ventas y compras', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const crudo = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
      const p: Buffer[] = [];
      res.on('data', (c: Buffer) => p.push(c));
      res.on('end', () => cb(null, Buffer.concat(p)));
    });

  it('libro IVA ventas: filas, signos, pesos y cuadre con el Mayor', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const r = (await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.filas.map((f: { comprobante: string }) => f.comprobante)).toEqual([
      'Factura A 0001-00000001', 'Factura B 0001-00000001', 'Nota de crédito A 0001-00000001', 'Factura A 0001-00000002',
    ]);
    expect(r.totales.netoPorAlicuota['21']).toBe('2000.00');
    expect(r.totales.ivaPorAlicuota['10.5']).toBe('52.50');
    expect(r.filas[2].total).toBe('-100.00');
    expect(r.filas[3].exento).toBe('100000.00');
    expect(r.advertencias).toEqual([]);
  });

  it('libro IVA compras con cuadre', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const r = (await v.http.get('/api/impuestos/libro-iva-compras?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.filas[0].ivaPorAlicuota['21']).toBe('210.00');
    expect(r.advertencias).toEqual([]);
  });

  it('Excel y PDF', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const x = await crudo(v.token, '/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheet');
    const p = await crudo(v.token, '/api/impuestos/libro-iva-compras?desde=2026-11-01&hasta=2026-11-30&formato=pdf');
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('avisa cuando el IVA del libro no coincide con el Mayor', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    await v.http.post('/api/contabilidad/asientos', {
      fecha: '2026-11-10', descripcion: 'Ajuste IVA',
      renglones: [{ cuentaContableId: await v.cuenta('5.2.01'), debe: 50 }, { cuentaContableId: await v.cuenta('2.1.02.001'), haber: 50 }],
    });
    const r = (await v.http.get('/api/impuestos/libro-iva-ventas?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.advertencias).toEqual(['El IVA del libro (472.50) difiere del Mayor de la cuenta 2.1.02.001 (522.50)']);
  });
});
