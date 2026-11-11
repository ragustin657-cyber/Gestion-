import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararStock } from './helpers-stock';
import { prepararVentas } from './helpers-ventas';

describe('stock: ventas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  async function escenario(conDeposito = true) {
    const v = await prepararVentas(app, prisma);
    const t = await prepararStock(app, prisma, v);
    if (conDeposito) await v.http.patch(`/api/empresas/actual/puntos-venta/${v.puntoVenta.id}`, { depositoId: t.deposito.id });
    const renglon = (articuloId: string, cantidad: number, precioUnitario = 100) => ({ articuloId, descripcion: 'Producto', cantidad, precioUnitario, alicuota: 21 });
    const crear = (o: Record<string, unknown>) => v.http.post('/api/ventas/comprobantes', { ...v.datos(o), emitir: true });
    const costoVenta = (id: string) => prisma.asiento.findFirst({ where: { origenTipo: 'COSTO_VENTA', origenId: id } });
    return { ...v, ...t, renglon, crear, costoVenta };
  }

  it('toma el depósito del punto de venta', async () => {
    const e = await escenario();
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const f = await e.crear({ renglones: [e.renglon(a.id, 1)] });
    expect(f.status).toBe(201);
    expect((await prisma.comprobanteVenta.findUniqueOrThrow({ where: { id: f.body.id } })).depositoId).toBe(e.deposito.id);
    await e.http.patch(`/api/empresas/actual/puntos-venta/${e.puntoVenta.id}`, { depositoId: null });
    const sin = await e.crear({ renglones: [e.renglon(a.id, 1)] });
    expect(sin.status).toBe(400);
    expect(sin.body.message).toBe('Indique el depósito: hay artículos que controlan stock');
    expect((await e.crear({ renglones: [e.renglon(a.id, 1)], depositoId: e.deposito2.id })).status).toBe(400);
  });

  it('controla al crear y descuenta al emitir con asiento de costo', async () => {
    const e = await escenario();
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const mucho = await e.crear({ renglones: [e.renglon(a.id, 12)] });
    expect(mucho.status).toBe(400);
    expect(mucho.body.message).toBe('Stock insuficiente de ART-1 en Central: hay 10, se piden 12');
    const f = await e.crear({ renglones: [e.renglon(a.id, 4)] });
    expect(f.status).toBe(201);
    expect(f.body.estado).toBe('AUTORIZADO');
    expect(await e.estado(a.id)).toMatchObject({ cantidad: '6', valor: '60' });
    expect(await e.renglonesAsiento((await e.costoVenta(f.body.id))!.id)).toEqual([['1.1.05.001', 'H 40.00'], ['5.1.01', 'D 40.00']]);
  });

  it('suma renglones del mismo artículo', async () => {
    const e = await escenario();
    const a = await e.articulo();
    await e.inicial(a.id, 5, 10);
    const r = await e.crear({ renglones: [e.renglon(a.id, 3), e.renglon(a.id, 3)] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Stock insuficiente de ART-1 en Central: hay 5, se piden 6');
  });

  it('con aviso emite igual', async () => {
    const e = await escenario();
    await e.modo('AVISAR');
    const a = await e.articulo();
    await e.inicial(a.id, 10, 10);
    const borrador = await e.http.post('/api/ventas/comprobantes', e.datos({ renglones: [e.renglon(a.id, 12)] }));
    expect(borrador.status).toBe(201);
    expect(borrador.body.advertencias).toEqual(['Stock insuficiente de ART-1 en Central: hay 10, se piden 12']);
    const em = await e.http.post(`/api/ventas/comprobantes/${borrador.body.id}/emitir`, {});
    expect(em.body.estado).toBe('AUTORIZADO');
    expect(em.body.advertencias).toContain('Stock insuficiente de ART-1 en Central: hay 10, se piden 12');
    expect(await e.estado(a.id)).toMatchObject({ cantidad: '-2' });
  });

  it('nota de crédito con devolución vuelve al costo de salida', async () => {
    const e = await escenario();
    const a = await e.articulo();
    await e.inicial(a.id, 3, 10);
    await e.inicial(a.id, 3, 20);
    const f = await e.crear({ renglones: [e.renglon(a.id, 4)] });
    expect(await e.renglonesAsiento((await e.costoVenta(f.body.id))!.id)).toEqual([['1.1.05.001', 'H 60.00'], ['5.1.01', 'D 60.00']]);
    await e.inicial(a.id, 10, 30);
    const nc = (o: Record<string, unknown>) => e.crear({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f.body.id, ...o });
    const demas = await nc({ devuelveMercaderia: true, renglones: [e.renglon(a.id, 5, 10)] });
    expect(demas.status).toBe(400);
    expect(demas.body.message).toBe('No se puede devolver más de lo vendido de ART-1');
    const ok = await nc({ devuelveMercaderia: true, renglones: [e.renglon(a.id, 1)] });
    expect(ok.status).toBe(201);
    const m = await prisma.movimientoStock.findFirstOrThrow({ where: { origenId: ok.body.id } });
    expect([m.tipo, m.cantidad.toString(), m.importe.toString()]).toEqual(['DEVOLUCION_VENTA', '1', '15']);
    expect(await e.renglonesAsiento((await e.costoVenta(ok.body.id))!.id)).toEqual([['1.1.05.001', 'D 15.00'], ['5.1.01', 'H 15.00']]);
    const otra = await nc({ devuelveMercaderia: true, renglones: [e.renglon(a.id, 4, 10)] });
    expect(otra.body.message).toBe('No se puede devolver más de lo vendido de ART-1');
    const sinDev = await nc({ renglones: [e.renglon(a.id, 1, 10)] });
    expect(sinDev.status).toBe(201);
    expect(await prisma.movimientoStock.count({ where: { origenId: sinDev.body.id } })).toBe(0);
  });

  it('no mueve stock de servicios ni artículos sin control', async () => {
    const e = await escenario(false);
    const a = await e.articulo(false);
    const f = await e.crear({ renglones: [e.renglon(a.id, 3)] });
    expect(f.status).toBe(201);
    expect(await prisma.movimientoStock.count({ where: { origenId: f.body.id } })).toBe(0);
    expect(await e.costoVenta(f.body.id)).toBeNull();
  });

  it('devuelveMercaderia solo en notas de crédito', async () => {
    const e = await escenario();
    const a = await e.articulo();
    await e.inicial(a.id, 5, 10);
    const r = await e.crear({ devuelveMercaderia: true, renglones: [e.renglon(a.id, 1)] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Solo las notas de crédito devuelven mercadería');
  });
});
