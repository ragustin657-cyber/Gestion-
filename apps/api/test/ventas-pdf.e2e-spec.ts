import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

/** Texto de un PDF sin comprimir generado por pdfkit (cadenas hexadecimales de los operadores TJ). */
function textoPdf(pdf: Buffer): string {
  const s = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const hex = [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]).join('');
    partes.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  return partes.join('\n');
}

describe('PDF del comprobante de venta', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const pdf = (token: string, id: string) =>
    request(app.getHttpServer()).get(`/api/ventas/comprobantes/${id}/pdf`).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });

  it('factura A con CAE, IVA discriminado, QR y leyenda de homologación', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const r = await pdf(v.token, fc.id);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    const buf = r.body as Buffer;
    const t = textoPdf(buf);
    for (const s of ['FACTURA', 'Cód. 01', '0001-00000001', 'CAE', fc.cae, 'IVA 21%', 'SIN VALIDEZ FISCAL', 'Distribuidora Norte SA', '1.210,00']) expect(t).toContain(s);
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('factura B: no discrimina IVA', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura({ terceroId: v.clienteCF.id });
    const t = textoPdf((await pdf(v.token, fc.id)).body as Buffer);
    expect(t).toContain('Cód. 06');
    expect(t).not.toContain('IVA 21%');
    expect(t).toContain('1.210,00');
  });

  it('un comprobante sin CAE no tiene PDF', async () => {
    const v = await prepararVentas(app, prisma);
    const fc = (await v.http.post('/api/ventas/comprobantes', v.datos())).body;
    const r = await v.http.get(`/api/ventas/comprobantes/${fc.id}/pdf`);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El comprobante no tiene CAE');
  });
});
