import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase } from './helpers';
import { escenarioInformes } from './helpers-informes';
import { prepararVentas } from './helpers-ventas';

describe('informes: antigüedad de saldos y rotación', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const vence = (origenId: string, fecha: string) => prisma.movimientoCuentaCorriente.updateMany({ where: { origenId }, data: { fechaVencimiento: new Date(`${fecha}T00:00:00Z`) } });

  it('antigüedad de clientes por tramos', async () => {
    const v = await prepararVentas(app, prisma);
    for (const fecha of ['2026-12-10', '2026-11-20', '2026-10-16', '2026-09-16', '2026-08-02']) await vence((await v.factura()).id, fecha);
    const r = (await v.http.get('/api/informes/antiguedad?tipo=clientes&fecha=2026-11-30')).body;
    expect(r.filas).toEqual([expect.objectContaining({ terceroId: v.clienteRI.id, aVencer: '1210.00', d1_30: '1210.00', d31_60: '1210.00', d61_90: '1210.00', mas90: '1210.00', aFavor: '0.00', total: '6050.00' })]);
    expect(r.totales).toMatchObject({ total: '6050.00', mas90: '1210.00' });
  });

  it('anticipo mayor que la deuda', async () => {
    const v = await prepararVentas(app, prisma);
    await vence((await v.factura()).id, '2026-11-20');
    await v.cobro(2000);
    const r = (await v.http.get('/api/informes/antiguedad?tipo=clientes&fecha=2026-11-30')).body;
    expect(r.filas[0]).toMatchObject({ aFavor: '-2000.00', d1_30: '1210.00', total: '-790.00' });
  });

  it('antigüedad de proveedores', async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura();
    const d = await datosCompras(prisma, v.empresaId);
    const f = await facturaPendiente(v.http, prisma, { proveedorId: d.proveedorId, neto: 1000, fecha: '2026-11-02' });
    await vence(f.comprobanteId, '2026-10-01');
    const r = (await v.http.get('/api/informes/antiguedad?tipo=proveedores&fecha=2026-11-30')).body;
    expect(r.filas).toEqual([expect.objectContaining({ terceroId: d.proveedorId, d31_60: '1210.00', total: '1210.00' })]);
  });

  it('rotación del ejemplo', async () => {
    const e = await escenarioInformes(app, prisma);
    const r = (await e.http.get('/api/informes/rotacion?desde=2026-11-01&hasta=2026-11-30')).body;
    expect(r.filas).toEqual([expect.objectContaining({ articuloId: e.a.id, stockInicial: '0.00', stockFinal: '670.00', costoVendido: '330.00', rotacion: '0.99', diasCobertura: '60.9' })]);
  });

  it('exporta antigüedad', async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura();
    const r = await v.http.get('/api/informes/antiguedad?tipo=clientes&fecha=2026-11-30&formato=xlsx').buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect((await v.http.get('/api/informes/antiguedad?tipo=otros&fecha=2026-11-30')).status).toBe(400);
  });
});
