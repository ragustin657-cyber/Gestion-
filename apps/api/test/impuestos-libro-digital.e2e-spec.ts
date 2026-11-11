import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase, otroUsuario } from './helpers';
import { periodoConMovimientos } from './helpers-impuestos';

describe('Libro IVA Digital e historial de presentaciones', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const bajar = (token: string, id: string) =>
    request(app.getHttpServer()).get(`/api/impuestos/presentaciones/${id}/archivo`).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
      const p: Buffer[] = [];
      res.on('data', (c: Buffer) => p.push(c));
      res.on('end', () => cb(null, Buffer.concat(p)));
    });
  const lineas = async (zip: JSZip, nombre: string) => {
    const t = Buffer.from(await zip.file(nombre)!.async('uint8array')).toString('latin1');
    return { t, ls: t.split('\r\n').filter(Boolean) };
  };

  it('ZIP con los cuatro archivos, largos, NC, USD y exentos', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const g = await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ nombreArchivo: 'LIBRO_IVA_DIGITAL_30712345671_202611.zip', registros: 5 });
    const zip = await JSZip.loadAsync((await bajar(v.token, g.body.id)).body as Buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['COMPRAS_ALICUOTAS.txt', 'COMPRAS_CBTE.txt', 'VENTAS_ALICUOTAS.txt', 'VENTAS_CBTE.txt']);
    const vc = await lineas(zip, 'VENTAS_CBTE.txt');
    const va = await lineas(zip, 'VENTAS_ALICUOTAS.txt');
    const cc = await lineas(zip, 'COMPRAS_CBTE.txt');
    const ca = await lineas(zip, 'COMPRAS_ALICUOTAS.txt');
    expect(vc.t.endsWith('\r\n')).toBe(true);
    expect(vc.ls).toHaveLength(4);
    for (const [l, n] of [[vc, 266], [va, 62], [cc, 325], [ca, 84]] as const) for (const x of l.ls) expect(x).toHaveLength(n);
    const [fa, , nc, usd] = vc.ls;
    expect([fa.slice(0, 8), fa.slice(8, 11), fa.slice(241, 242)]).toEqual(['20261102', '001', '2']);
    expect([nc.slice(8, 11), nc.slice(108, 123)]).toEqual(['003', '000000000010000']);
    expect([usd.slice(228, 231), usd.slice(231, 241), usd.slice(108, 123), usd.slice(242, 243)]).toEqual(['DOL', '1000000000', '000000000010000', 'E']);
    const alicUsd = va.ls.filter((x) => x.slice(0, 28) === usd.slice(8, 11) + usd.slice(11, 16) + usd.slice(16, 36));
    expect(alicUsd.map((x) => [x.slice(43, 47), x.slice(28, 43)])).toEqual([['0003', '000000000000000']]);
    const libro = (await v.http.get('/api/impuestos/libro-iva-compras?desde=2026-11-01&hasta=2026-11-30')).body;
    const suma = cc.ls.reduce((s, x) => s + Number(x.slice(104, 119)) / 100, 0);
    expect(suma.toFixed(2)).toBe(libro.totales.total);
  });

  it('período sin movimientos: archivos vacíos con advertencia', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    const g = await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202602' });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ registros: 0, advertencias: ['No hay comprobantes en 02/2026'] });
  });

  it('historial: avisa cuando los datos cambiaron y conserva el archivo original', async () => {
    const { v, proveedorId } = await periodoConMovimientos(app, prisma);
    const g = (await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })).body;
    const antes = (await bajar(v.token, g.id)).body as Buffer;
    expect((await v.http.get('/api/impuestos/presentaciones')).body).toEqual([expect.objectContaining({ id: g.id, cambiaron: false, tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })]);
    await facturaPendiente(v.http, prisma, { proveedorId, neto: 300 });
    expect((await v.http.get('/api/impuestos/presentaciones')).body[0].cambiaron).toBe(true);
    const despues = (await bajar(v.token, g.id)).body as Buffer;
    expect(createHash('sha256').update(despues).digest('hex')).toBe(createHash('sha256').update(antes).digest('hex'));
  });

  it('validaciones y permisos', async () => {
    const { v } = await periodoConMovimientos(app, prisma);
    expect((await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202613' })).status).toBe(400);
    expect((await v.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611', quincena: 1 })).status).toBe(400);
    const ver = await otroUsuario(app, prisma, v.empresaId, ['impuestos.ver']);
    expect((await ver.http.post('/api/impuestos/presentaciones', { tipo: 'LIBRO_IVA_DIGITAL', periodo: '202611' })).status).toBe(403);
  });
});
