import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('cobranzas: resumen de cuenta en PDF', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('resumen en PDF', async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura({ fecha: '2026-10-01', fechaVencimiento: '2026-10-31' });
    const r = await v.http.get(`/api/ventas/cobranzas/${v.clienteRI.id}/resumen.pdf`).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect([r.status, r.headers['content-type']]).toEqual([200, 'application/pdf']);
    expect(r.headers['content-disposition']).toContain('resumen-de-cuenta-distribuidora-norte-sa.pdf');
    // pdfkit escribe el texto en hexadecimal (fuentes estándar): se decodifican los tramos <...> de cada línea
    const crudo = (r.body as Buffer).toString('latin1');
    const texto = [...crudo.matchAll(/\[([^\]]*)\] TJ/g)].map((m) => [...m[1].matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
    expect(texto).toContain('Distribuidora Norte SA');
    expect(texto).toContain('1.210,00');
  });
});
