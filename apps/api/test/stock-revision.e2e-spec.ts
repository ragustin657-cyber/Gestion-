import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada } from './helpers';
import { prepararStock } from './helpers-stock';
import { prepararVentas } from './helpers-ventas';

describe('stock: correcciones de la revisión final', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let remito = 900;
  let numero = 9000;
  async function compras(conStock = true) {
    const v = await prepararVentas(app, prisma);
    const t = await prepararStock(app, prisma, v);
    const d = await datosCompras(prisma, v.empresaId);
    if (conStock) await prisma.articulo.update({ where: { id: d.articuloId }, data: { controlaStock: true } });
    const http = v.http;
    const oc = (cantidad: number, precio: number) => ocAprobada(http, prisma, v.empresaId, d, cantidad, precio);
    const recibir = async (ocr: { renglones: { id: string }[] }, cantidad: number) => {
      const r = await http.post('/api/compras/recepciones', { terceroId: d.proveedorId, fecha: '2026-11-05', depositoId: t.deposito.id, remitoNumero: `0002-${String(++remito).padStart(8, '0')}`, renglones: [{ ordenCompraRenglonId: ocr.renglones[0].id, cantidad }] });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return r.body as { id: string; renglones: { id: string }[] };
    };
    const factura = (renglones: Record<string, unknown>[], o: Record<string, unknown> = {}) => {
      const neto = renglones.reduce((s, r) => s + Number(r.cantidad) * Number(r.precioUnitario), 0);
      return http.post('/api/compras/comprobantes', {
        terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-05', fechaContable: '2026-11-05',
        monedaCodigo: 'ARS', totalDeclarado: Math.round(neto * 121) / 100, aceptoDiferencias: true,
        renglones: renglones.map((r) => ({ descripcion: 'Mercadería', alicuotaIva: 21, ...r })), ...o,
      });
    };
    const control = async () => (await http.get('/api/stock/valuacion?fecha=2026-11-30')).body.control as string;
    return { ...v, ...t, ...d, oc, recibir, factura, control };
  }

  it('un artículo con stock no se factura desde la orden de compra', async () => {
    const e = await compras();
    const o = await e.oc(10, 10);
    const r = await e.factura([{ origen: 'ORDEN_COMPRA', ordenCompraRenglonId: o.renglones[0].id, cantidad: 10, precioUnitario: 10 }]);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Los artículos que controlan stock se facturan desde la recepción o como compra directa');
  });

  it('la emisión controla el stock antes de pedir el CAE', async () => {
    const e = await compras();
    await e.http.patch(`/api/empresas/actual/puntos-venta/${e.puntoVenta.id}`, { depositoId: e.deposito.id });
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const borrador = async () => (await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [{ articuloId: a.id, descripcion: 'P', cantidad: 10, precioUnitario: 100, alicuota: 21 }] }))).body as { id: string };
    const ba = await borrador();
    const bb = await borrador();
    expect((await e.http.post(`/api/ventas/comprobantes/${ba.id}/emitir`, {})).body.estado).toBe('AUTORIZADO');
    const r = await e.http.post(`/api/ventas/comprobantes/${bb.id}/emitir`, {});
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Stock insuficiente de ART-1 en Central: hay 0, se piden 10');
    const b = await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: bb.id } });
    expect([b.estado === 'AUTORIZADO', b.numeroReservado, b.cae]).toEqual([false, null, null]);
  });

  it('una recepción y una factura simultáneas del mismo artículo no se bloquean', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const e = await compras();
      const o = await e.oc(10, 10);
      const rs = await Promise.all([
        e.http.post('/api/compras/recepciones', { terceroId: e.proveedorId, fecha: '2026-11-05', depositoId: e.deposito.id, remitoNumero: `0003-${String(++remito).padStart(8, '0')}`, renglones: [{ ordenCompraRenglonId: o.renglones[0].id, cantidad: 10 }] }),
        e.factura([{ origen: 'DIRECTO', articuloId: e.articuloId, cantidad: 5, precioUnitario: 12 }], { depositoId: e.deposito.id }),
      ]);
      expect(rs.map((r) => r.status)).toEqual([201, 201]);
    }
  });

  it('las facturas sin artículos con stock no necesitan los conceptos de stock', async () => {
    const e = await compras(false);
    await prisma.configCuenta.deleteMany({ where: { empresaId: e.empresaId, concepto: { in: ['MERCADERIAS', 'MERCADERIA_A_FACTURAR'] } } });
    const r = await e.factura([{ origen: 'DIRECTO', articuloId: e.articuloId, cantidad: 1, precioUnitario: 100 }]);
    expect(r.status).toBe(201);
  });

  it('facturar una recepción hecha antes de controlar stock la ingresa como compra', async () => {
    const e = await compras(false);
    const o = await e.oc(10, 10);
    const ir = await e.recibir(o, 10);
    await prisma.articulo.update({ where: { id: e.articuloId }, data: { controlaStock: true } });
    const f = await e.factura([{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, cantidad: 10, precioUnitario: 11 }]);
    expect(f.status).toBe(201);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '10', valor: '110' });
    expect(await e.control()).toBe('0.00');
    const mrf = await prisma.asientoRenglon.findMany({ where: { empresaId: e.empresaId, cuentaContableId: await e.cuenta('2.1.01.003') } });
    expect(mrf.reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0)).toBe(0);
  });

  it('la regularización de una anulación con stock negativo se contabiliza', async () => {
    const e = await compras();
    await e.modo('AVISAR');
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    await e.inicial(a.id, 10, 20);
    const sal = await e.salida(a.id, 25);
    await e.inicial(a.id, 2, 30);
    expect((await e.http.post(`/api/stock/documentos/${sal.body.id}/anular`, { motivo: 'Error' })).status).toBe(201);
    expect(await e.control()).toBe('0.00');
  });

  it('anular un ajuste de costo sin stock no deja valor con cantidad cero', async () => {
    const e = await compras();
    const o = await e.oc(100, 10);
    const ir = await e.recibir(o, 100);
    const f = await e.factura([{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, cantidad: 100, precioUnitario: 11 }]);
    await e.salida(e.articuloId, 100);
    expect((await e.http.post(`/api/compras/comprobantes/${f.body.id}/anular`, { motivo: 'Error' })).status).toBe(200);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '0', valor: '0' });
    expect(await e.control()).toBe('0.00');
  });

  it('una factura en dólares de varios renglones cuadra con el Mayor', async () => {
    const e = await compras();
    const b = await prisma.articulo.create({ data: { empresaId: e.empresaId, codigo: 'B-2', descripcion: 'B', alicuotaIva: 21, controlaStock: true } });
    const c = await prisma.articulo.create({ data: { empresaId: e.empresaId, codigo: 'C-3', descripcion: 'C', alicuotaIva: 21, controlaStock: true } });
    const f = await e.factura([
      { origen: 'DIRECTO', articuloId: e.articuloId, cantidad: 1, precioUnitario: 1.11 },
      { origen: 'DIRECTO', articuloId: b.id, cantidad: 1, precioUnitario: 2.22 },
      { origen: 'DIRECTO', articuloId: c.id, cantidad: 1, precioUnitario: 3.33 },
    ], { depositoId: e.deposito.id, monedaCodigo: 'USD', cotizacion: 1000.5 });
    expect(f.status).toBe(201);
    expect(await e.control()).toBe('0.00');
  });
});
