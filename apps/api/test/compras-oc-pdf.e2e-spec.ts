import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, sesionConPlan } from './helpers';

describe('PDF de orden de compra', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const binario = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
    const partes: Buffer[] = [];
    res.on('data', (c: Buffer) => partes.push(c));
    res.on('end', () => cb(null, Buffer.concat(partes)));
  };

  it('OC confirmada → PDF; borrador → 400', async () => {
    const s = await sesionConPlan(app, prisma);
    const d = await datosCompras(prisma, s.empresaId);
    const oc = await ocAprobada(s.http, prisma, s.empresaId, d);
    const r = await request(app.getHttpServer()).get(`/api/compras/ordenes/${oc.id}/pdf`).set('Authorization', `Bearer ${s.token}`).buffer(true).parse(binario);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const b = (await s.http.post('/api/compras/ordenes', { terceroId: d.proveedorId, fecha: '2026-11-05', monedaCodigo: 'ARS', renglones: [{ descripcion: 'x', cantidad: 1, precioUnitario: 1, alicuotaIva: 21 }] })).body;
    const e = await s.http.get(`/api/compras/ordenes/${b.id}/pdf`);
    expect(e.status).toBe(400);
    expect(e.body.message).toBe('La orden no está confirmada');
  });
});
