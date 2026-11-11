import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada } from './helpers';
import { prepararStock } from './helpers-stock';

describe('stock: compras', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  let remito = 100;
  let numero = 500;
  async function escenario() {
    const t = await prepararStock(app, prisma);
    const d = await datosCompras(prisma, t.s.empresaId);
    await prisma.articulo.update({ where: { id: d.articuloId }, data: { controlaStock: true } });
    const http = t.s.http;
    const recibir = async (cantidad: number, precio: number, o: Record<string, unknown> = {}, moneda = 'ARS') => {
      const oc = await ocAprobada(http, prisma, t.s.empresaId, d, cantidad, precio, moneda);
      const r = await http.post('/api/compras/recepciones', {
        terceroId: d.proveedorId, fecha: '2026-11-05', depositoId: t.deposito.id, remitoNumero: `0001-${String(++remito).padStart(8, '0')}`,
        renglones: [{ ordenCompraRenglonId: oc.renglones[0].id, cantidad }], ...o,
      });
      return r;
    };
    const factura = (renglones: Record<string, unknown>[], o: Record<string, unknown> = {}) => {
      const neto = renglones.reduce((s, r) => s + Number(r.cantidad) * Number(r.precioUnitario), 0);
      return http.post('/api/compras/comprobantes', {
        terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero, fechaEmision: '2026-11-05', fechaContable: '2026-11-05',
        monedaCodigo: 'ARS', totalDeclarado: Math.round(neto * 121) / 100, aceptoDiferencias: true,
        renglones: renglones.map((r) => ({ descripcion: 'Mercadería', alicuotaIva: 21, ...r })), ...o,
      });
    };
    const deIr = (ir: { renglones: { id: string }[] }, cantidad: number, precioUnitario: number) => ({ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, cantidad, precioUnitario });
    const directo = (cantidad: number, precioUnitario: number) => ({ origen: 'DIRECTO', articuloId: d.articuloId, cantidad, precioUnitario });
    const asientoStock = (comprobanteId: string) => prisma.asiento.findFirst({ where: { origenTipo: 'STOCK_COMPRA', origenId: comprobanteId } });
    return { ...t, ...d, recibir, factura, deIr, directo, asientoStock };
  }

  it('la recepción exige depósito y entra al precio de la OC', async () => {
    const e = await escenario();
    const sin = await e.recibir(100, 10, { depositoId: null });
    expect(sin.status).toBe(400);
    expect(sin.body.message).toBe('Indique el depósito: hay artículos que controlan stock');
    const ir = await e.recibir(100, 10);
    expect(ir.status).toBe(201);
    expect(await e.estado(e.articuloId)).toEqual({ cantidad: '100', valor: '1000', promedio: '10' });
    const irDb = await prisma.informeRecepcion.findUniqueOrThrow({ where: { id: ir.body.id } });
    expect(await e.renglonesAsiento(irDb.asientoId!)).toEqual([['1.1.05.001', 'D 1000.00'], ['2.1.01.003', 'H 1000.00']]);
    await prisma.articulo.update({ where: { id: e.articuloId }, data: { controlaStock: false } });
    const sinStock = await e.recibir(5, 10, { depositoId: null });
    expect(sinStock.status).toBe(201);
    expect((await prisma.informeRecepcion.findUniqueOrThrow({ where: { id: sinStock.body.id } })).asientoId).toBeNull();
  });

  it('factura con diferencia de precio, stock completo', async () => {
    const e = await escenario();
    const ir = (await e.recibir(100, 10)).body;
    const f = await e.factura([e.deIr(ir, 100, 11)]);
    expect(f.status).toBe(201);
    const cfac = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: f.body.id } });
    const principal = await e.renglonesAsiento(cfac.asientoId!);
    expect(principal).toContainEqual(['2.1.01.003', 'D 1100.00']);
    expect(await e.renglonesAsiento((await e.asientoStock(f.body.id))!.id)).toEqual([['1.1.05.001', 'D 100.00'], ['2.1.01.003', 'H 100.00']]);
    expect(await e.estado(e.articuloId)).toEqual({ cantidad: '100', valor: '1100', promedio: '11' });
  });

  it('factura con parte vendida reparte la diferencia', async () => {
    const e = await escenario();
    const ir = (await e.recibir(100, 10)).body;
    await e.salida(e.articuloId, 60);
    const f = await e.factura([e.deIr(ir, 100, 11)]);
    const ajuste = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: f.body.id, tipo: 'AJUSTE_COSTO' } });
    expect(ajuste.importe.toString()).toBe('40');
    expect(await e.renglonesAsiento((await e.asientoStock(f.body.id))!.id)).toEqual([['1.1.05.001', 'D 40.00'], ['2.1.01.003', 'H 100.00'], ['5.1.01', 'D 60.00']]);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '40', valor: '440' });
  });

  it('factura directa con depósito', async () => {
    const e = await escenario();
    const sin = await e.factura([e.directo(50, 13)]);
    expect(sin.status).toBe(400);
    expect(sin.body.message).toBe('Indique el depósito: hay artículos que controlan stock');
    const f = await e.factura([e.directo(50, 13)], { depositoId: e.deposito.id });
    expect(f.status).toBe(201);
    expect(await e.estado(e.articuloId)).toEqual({ cantidad: '50', valor: '650', promedio: '13' });
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: f.body.id } });
    expect(await e.renglonesAsiento(c.asientoId!)).toContainEqual(['1.1.05.001', 'D 650.00']);
    expect(await e.asientoStock(f.body.id)).toBeNull();
  });

  it('factura directa en USD', async () => {
    const e = await escenario();
    const f = await e.factura([e.directo(10, 2)], { depositoId: e.deposito.id, monedaCodigo: 'USD', cotizacion: 1000 });
    expect(f.status).toBe(201);
    const m = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: f.body.id } });
    expect([m.importe.toString(), m.costoUnitario.toString()]).toEqual(['20000', '2000']);
  });

  it('nota de crédito de compra ajusta costo', async () => {
    const e = await escenario();
    await e.recibir(100, 10);
    const nc = await e.factura([e.directo(1, 50)], { tipo: 'NOTA_CREDITO' });
    expect(nc.status).toBe(201);
    const m = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: nc.body.id } });
    expect([m.tipo, m.cantidad.toString(), m.importe.toString()]).toEqual(['AJUSTE_COSTO', '0', '-50']);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '100', valor: '950' });
    const c = await prisma.comprobanteCompra.findUniqueOrThrow({ where: { id: nc.body.id } });
    expect(await e.renglonesAsiento(c.asientoId!)).toContainEqual(['1.1.05.001', 'H 50.00']);
  });

  it('anular la recepción con stock vendido', async () => {
    const e = await escenario();
    const ir = (await e.recibir(10, 10)).body;
    await e.salida(e.articuloId, 8);
    const r = await e.s.http.post(`/api/compras/recepciones/${ir.id}/anular`, { motivo: 'Error' });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe(`Stock insuficiente de ${(await prisma.articulo.findUniqueOrThrow({ where: { id: e.articuloId } })).codigo} en Central: hay 2, se piden 10`);
    await e.modo('AVISAR');
    const ok = await e.s.http.post(`/api/compras/recepciones/${ir.id}/anular`, { motivo: 'Error' });
    expect(ok.status).toBe(200);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '-8' });
    expect((await prisma.informeRecepcion.findUniqueOrThrow({ where: { id: ir.id } })).asientoAnulacionId).toBeTruthy();
  });

  it('anular la factura revierte stock y asientos', async () => {
    const e = await escenario();
    const ir = (await e.recibir(100, 10)).body;
    const f1 = await e.factura([e.deIr(ir, 100, 11)]);
    const r1 = await e.s.http.post(`/api/compras/comprobantes/${f1.body.id}/anular`, { motivo: 'Error' });
    expect(r1.status).toBe(200);
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '100', valor: '1000' });
    expect(await prisma.asiento.count({ where: { anulaAId: (await e.asientoStock(f1.body.id))!.id } })).toBe(1);
    const f2 = await e.factura([e.directo(50, 13)], { depositoId: e.deposito.id });
    await e.s.http.post(`/api/compras/comprobantes/${f2.body.id}/anular`, { motivo: 'Error' });
    expect(await e.estado(e.articuloId)).toMatchObject({ cantidad: '100', valor: '1000' });
  });
});
