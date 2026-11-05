import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, facturaPendiente, limpiarBase } from './helpers';
import { prepararPagos } from './helpers-pagos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binario = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const partes: Buffer[] = [];
  res.on('data', (c: Buffer) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};

describe('consultas de pagos y PDF', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conPago() {
    const p = await prepararPagos(app, prisma, { regimen: '94', iibb: 2 });
    const f = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 100000 });
    const op = await p.opAprobada([{ movimientoId: f.movimientoId, importe: 121000 }]);
    const pagada = (await p.pagar(op, [{ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: 118343.4, cuentaBancariaId: p.ars.id }])).body;
    return { ...p, f, pagada };
  }
  const bajar = (token: string, url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`).buffer(true).parse(binario);

  it('pagos a realizar: comprobantes vencidos y OP aprobadas', async () => {
    const p = await prepararPagos(app, prisma);
    await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 1000, fecha: '2026-09-01' });
    const f2 = await facturaPendiente(p.http, prisma, { proveedorId: p.proveedorId, neto: 2000 });
    await p.opAprobada([{ movimientoId: f2.movimientoId, importe: 2420 }]);
    const r = (await p.http.get('/api/pagos/pagos-a-realizar?fecha=2026-11-15')).body;
    expect(r.comprobantes.find((c: { saldo: string }) => c.saldo === '1210')).toMatchObject({ vencido: true });
    expect(r.ordenesAprobadas).toHaveLength(1);
    expect(r.ordenesAprobadas[0].netoPagar).toBe('2420');
  });

  it('retenciones practicadas con certificado y exportación a Excel', async () => {
    const { http, token } = await conPago();
    const r = (await http.get('/api/pagos/retenciones?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.map((x: { certificado: string; importe: string }) => [x.certificado, x.importe]).sort()).toEqual([['RET-GAN 00000001', '656.60'], ['RET-IIBB-902 00000001', '2000.00']]);
    const x = await bajar(token, '/api/pagos/retenciones?desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets[0].getRow(wb.worksheets[0].rowCount).getCell(1).value).toBe('Totales');
    expect((await http.get('/api/pagos/retenciones?desde=abc&hasta=2026-11-30')).status).toBe(400);
  });

  it('PDF de la OP y de los certificados', async () => {
    const { token, pagada, http, proveedorId } = await conPago();
    expect((await bajar(token, `/api/pagos/ordenes/${pagada.id}/pdf`)).body.subarray(0, 4).toString()).toBe('%PDF');
    const ret = pagada.retenciones.find((x: { importe: string }) => Number(x.importe) > 0);
    const c = await bajar(token, `/api/pagos/ordenes/${pagada.id}/certificados/${ret.id}/pdf`);
    expect(c.status).toBe(200);
    expect(c.body.subarray(0, 4).toString()).toBe('%PDF');
    const f = await facturaPendiente(http, prisma, { proveedorId, neto: 1000 });
    const b = (await http.post('/api/pagos/ordenes', { terceroId: proveedorId, fecha: '2026-11-10', imputaciones: [{ movimientoId: f.movimientoId, importe: 1210 }] })).body;
    expect((await http.get(`/api/pagos/ordenes/${b.id}/pdf`)).status).toBe(400);
    const conf = (await http.post(`/api/pagos/ordenes/${b.id}/confirmar`, { version: b.version })).body;
    const retNoPagada = conf.retenciones[0];
    if (retNoPagada) {
      const e = await http.get(`/api/pagos/ordenes/${b.id}/certificados/${retNoPagada.id}/pdf`);
      expect(e.status).toBe(400);
      expect(e.body.message).toBe('La retención todavía no tiene certificado');
    }
  });

  it('la cuenta corriente muestra el pago y el saldo en 0', async () => {
    const { http, proveedorId } = await conPago();
    const cc = (await http.get(`/api/compras/cuenta-corriente/${proveedorId}`)).body;
    expect(cc.saldos.pesos).toBe('0.00');
    expect(cc.movimientos.map((m: { comprobante: string }) => m.comprobante)).toEqual(expect.arrayContaining([expect.stringMatching(/^OP 0001-00000001/)]));
    expect(cc.movimientos.at(-1).acumuladoPesos).toBe('0.00');
  });

  it('otra empresa no ve nada', async () => {
    const a = await conPago();
    const b = await prepararPagos(app, prisma);
    expect((await b.http.get(`/api/pagos/ordenes/${a.pagada.id}/pdf`)).status).toBe(404);
    expect((await b.http.get('/api/pagos/retenciones?desde=2026-11-01&hasta=2026-11-30')).body).toEqual([]);
  });
});
