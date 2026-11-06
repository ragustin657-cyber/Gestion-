import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, facturaPendiente, limpiarBase, sesionConPlan } from './helpers';
import { prepararVentas } from './helpers-ventas';

describe('consultas de ventas y cuenta corriente de clientes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function conMovimientos() {
    const v = await prepararVentas(app, prisma);
    const fc = await v.factura();
    const recibo = (await v.http.post('/api/ventas/recibos', { terceroId: v.clienteRI.id, fecha: '2026-11-03', puntoVentaId: v.puntoVenta.id, cajaId: v.caja.id, efectivo: { importe: 1000 }, aplicaciones: [{ comprobanteId: fc.id, importe: 1000 }] })).body;
    const nc = (await v.http.post('/api/ventas/comprobantes', v.datos({ tipo: 'NOTA_CREDITO', fecha: '2026-11-04', comprobanteAsociadoId: fc.id, renglones: [{ descripcion: 'Ajuste', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }], emitir: true }))).body;
    return { v, fc, recibo, nc };
  }

  it('cuenta corriente con saldo acumulado y comprobantes pendientes', async () => {
    const { v } = await conMovimientos();
    const cc = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/cuenta-corriente`)).body;
    expect(cc.saldoAnterior).toBe('0.00');
    expect(cc.movimientos.map((m: { saldo: string }) => m.saldo)).toEqual(['1210.00', '210.00', '110.00']);
    expect(cc.movimientos.map((m: { comprobante: string }) => m.comprobante)).toEqual(['Factura A 0001-00000001', 'Recibo 0001-00000001', 'Nota de crédito A 0001-00000001']);
    expect(cc.pendientes).toEqual([expect.objectContaining({ comprobante: 'Factura A 0001-00000001', saldo: '110.00', diasVencido: 0 })]);
    const desde = (await v.http.get(`/api/ventas/clientes/${v.clienteRI.id}/cuenta-corriente?desde=2026-11-03`)).body;
    expect(desde.saldoAnterior).toBe('1210.00');
    expect(desde.movimientos).toHaveLength(2);
  });

  it('listados de comprobantes y recibos', async () => {
    const { v, fc, recibo } = await conMovimientos();
    const l = (await v.http.get(`/api/ventas/comprobantes?terceroId=${v.clienteRI.id}&tipo=FACTURA`)).body;
    expect(l.total).toBe(1);
    expect(l.items[0]).toMatchObject({ id: fc.id, saldo: '110.00', estado: 'AUTORIZADO' });
    expect((await v.http.get(`/api/ventas/comprobantes/${fc.id}`)).body).toMatchObject({ numero: 1, saldo: '110.00' });
    const r = (await v.http.get('/api/ventas/recibos')).body;
    expect(r.items.map((x: { id: string }) => x.id)).toEqual([recibo.id]);
  });

  it('saldos por antigüedad', async () => {
    const v = await prepararVentas(app, prisma);
    await v.factura({ fecha: '2026-09-01', fechaVencimiento: '2026-09-22' });
    await v.factura({ fecha: '2026-11-02', fechaVencimiento: '2026-12-02' });
    const s = (await v.http.get('/api/ventas/saldos?fecha=2026-11-06')).body;
    expect(s.filas).toEqual([expect.objectContaining({ terceroId: v.clienteRI.id, saldo: '2420.00', noVencido: '1210.00', d31a60: '1210.00', d1a30: '0.00' })]);
  });

  it('un tercero cliente y proveedor: Compras y Pagos no ven sus ventas, Ventas no ve sus compras', async () => {
    const v = await prepararVentas(app, prisma);
    const { proveedorId } = await datosCompras(prisma, v.empresaId);
    await prisma.tercero.update({ where: { id: proveedorId }, data: { esCliente: true } });
    const venta = await v.factura({ terceroId: proveedorId });
    await facturaPendiente(v.http, prisma, { proveedorId, neto: 500 });
    const pend = (await v.http.get(`/api/pagos/pendientes?terceroId=${proveedorId}`)).body;
    expect(JSON.stringify(pend)).not.toContain((await v.movDe(venta.id)).id);
    const antig = (await v.http.get('/api/compras/antiguedad-deuda')).body;
    expect(JSON.stringify(antig)).not.toContain('1210');
    const ccProv = (await v.http.get(`/api/compras/cuenta-corriente/${proveedorId}`)).body;
    expect(ccProv.movimientos.every((m: { comprobante: string }) => !m.comprobante.startsWith('Factura A 0001'))).toBe(true);
    const ccCli = (await v.http.get(`/api/ventas/clientes/${proveedorId}/cuenta-corriente`)).body;
    expect(ccCli.movimientos.map((m: { comprobante: string }) => m.comprobante)).toEqual(['Factura A 0001-00000001']);
  });

  it('el Diario lleva a la factura y al recibo', async () => {
    const { v, fc, recibo } = await conMovimientos();
    const af = await prisma.asiento.findFirstOrThrow({ where: { origenTipo: 'VENTA', origenId: fc.id } });
    expect((await v.http.get(`/api/contabilidad/asientos/${af.id}`)).body.origen.ruta).toBe(`/ventas/comprobantes?id=${fc.id}`);
    expect((await v.http.get(`/api/contabilidad/asientos/${recibo.asientoId}`)).body.origen.ruta).toBe(`/ventas/recibos?id=${recibo.id}`);
  });

  it('un cliente de otra empresa no existe', async () => {
    const v = await prepararVentas(app, prisma);
    const otra = await sesionConPlan(app, prisma);
    expect((await otra.http.get(`/api/ventas/clientes/${v.clienteRI.id}/cuenta-corriente`)).status).toBe(404);
  });
});
