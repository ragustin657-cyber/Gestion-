import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, datosCompras, limpiarBase, ocAprobada, otroUsuario } from './helpers';
import { prepararStock } from './helpers-stock';
import { prepararVentas } from './helpers-ventas';

describe('stock: consultas y ejemplo completo', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('reproduce el ejemplo del spec', async () => {
    const v = await prepararVentas(app, prisma);
    const t = await prepararStock(app, prisma, v);
    const d = await datosCompras(prisma, v.empresaId);
    await prisma.articulo.update({ where: { id: d.articuloId }, data: { controlaStock: true } });
    await v.http.patch(`/api/empresas/actual/puntos-venta/${v.puntoVenta.id}`, { depositoId: t.deposito.id });
    const oc = await ocAprobada(v.http, prisma, v.empresaId, d, 100, 10);
    const ir = await v.http.post('/api/compras/recepciones', { terceroId: d.proveedorId, fecha: '2026-11-05', depositoId: t.deposito.id, remitoNumero: '0001-00000001', renglones: [{ ordenCompraRenglonId: oc.renglones[0].id, cantidad: 100 }] });
    expect(ir.status).toBe(201);
    const compra = (o: Record<string, unknown>, renglon: Record<string, unknown>, neto: number) => v.http.post('/api/compras/comprobantes', {
      terceroId: d.proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, fechaEmision: '2026-11-05', fechaContable: '2026-11-05', monedaCodigo: 'ARS',
      totalDeclarado: Math.round(neto * 121) / 100, aceptoDiferencias: true, renglones: [{ descripcion: 'Mercadería', alicuotaIva: 21, ...renglon }], ...o,
    });
    expect((await compra({ numero: 1 }, { origen: 'RECEPCION', informeRecepcionRenglonId: ir.body.renglones[0].id, cantidad: 100, precioUnitario: 11 }, 1100)).status).toBe(201);
    expect((await compra({ numero: 2, depositoId: t.deposito.id }, { origen: 'DIRECTO', articuloId: d.articuloId, cantidad: 50, precioUnitario: 13 }, 650)).status).toBe(201);
    const renglon = (cantidad: number) => ({ articuloId: d.articuloId, descripcion: 'Producto', cantidad, precioUnitario: 20, alicuota: 21 });
    const venta = await v.http.post('/api/ventas/comprobantes', { ...v.datos({ fecha: '2026-11-06', fechaVencimiento: '2026-12-06', renglones: [renglon(120)] }), emitir: true });
    expect(venta.body.estado).toBe('AUTORIZADO');
    const nc = await v.http.post('/api/ventas/comprobantes', { ...v.datos({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: venta.body.id, devuelveMercaderia: true, fecha: '2026-11-06', fechaVencimiento: '2026-12-06', renglones: [renglon(10)] }), emitir: true });
    expect(nc.body.estado).toBe('AUTORIZADO');

    expect(await t.estado(d.articuloId)).toEqual({ cantidad: '40', valor: '466.67', promedio: '11.66675' });
    const k = (await v.http.get(`/api/stock/kardex?articuloId=${d.articuloId}`)).body;
    expect(k.movimientos.map((m: { tipo: string; importe: string }) => [m.tipo, m.importe])).toEqual([
      ['RECEPCION', '1000.00'], ['AJUSTE_COSTO', '100.00'], ['COMPRA', '650.00'], ['VENTA', '-1400.00'], ['DEVOLUCION_VENTA', '116.67'],
    ]);
    expect(k.movimientos.at(-1).saldoValor).toBe('466.67');
    expect(k.movimientos.at(-1).saldoCantidad).toBe('40');
    expect(k.movimientos[0].documento).toBe('Recepción N° 1');
    const val = (await v.http.get('/api/stock/valuacion?fecha=2026-11-30')).body;
    expect(val).toMatchObject({ total: '466.67', mayor: '466.67', control: '0.00' });
    const cmv = await prisma.asientoRenglon.findMany({ where: { empresaId: v.empresaId, cuentaContableId: await v.cuenta('5.1.01') } });
    expect(cmv.reduce((s, r) => s + Number(r.debe) - Number(r.haber), 0).toFixed(2)).toBe('1283.33');
  });

  it('existencias por depósito', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    const b = await t.articulo();
    await t.inicial(a.id, 10, 10);
    await t.documento({ tipo: 'TRANSFERENCIA', depositoDestinoId: t.deposito2.id, renglones: [{ articuloId: a.id, cantidad: 4 }] });
    const r = (await t.s.http.get('/api/stock/existencias')).body;
    const fa = r.filas.find((f: { articuloId: string }) => f.articuloId === a.id);
    expect(fa).toMatchObject({ codigo: 'ART-1', cantidad: '10', costoPromedio: '10', valor: '100.00' });
    expect(fa.depositos.map((x: { nombre: string; cantidad: string }) => [x.nombre, x.cantidad])).toEqual([['Central', '6'], ['Sucursal', '4']]);
    expect(r.filas.some((f: { articuloId: string }) => f.articuloId === b.id)).toBe(true);
    const solo = (await t.s.http.get('/api/stock/existencias?soloConStock=true')).body;
    expect(solo.filas.map((f: { articuloId: string }) => f.articuloId)).toEqual([a.id]);
    expect(solo.total).toBe('100.00');
    const dep = (await t.s.http.get(`/api/stock/existencias?depositoId=${t.deposito2.id}&soloConStock=true`)).body;
    expect(dep.filas[0].depositos).toEqual([expect.objectContaining({ nombre: 'Sucursal', cantidad: '4' })]);
  });

  it('kardex con saldo inicial y por depósito', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10, { fecha: '2026-11-01' });
    await t.salida(a.id, 3, { fecha: '2026-11-03' });
    const k = (await t.s.http.get(`/api/stock/kardex?articuloId=${a.id}&desde=2026-11-02`)).body;
    expect(k.saldoInicial).toEqual({ cantidad: '10', valor: '100.00' });
    expect(k.movimientos.map((m: { salida: string; saldoCantidad: string }) => [m.salida, m.saldoCantidad])).toEqual([['3', '7']]);
    const kd = (await t.s.http.get(`/api/stock/kardex?articuloId=${a.id}&depositoId=${t.deposito.id}`)).body;
    expect(kd.movimientos.every((m: { saldoValor: string | null }) => m.saldoValor === null)).toBe(true);
    expect((await t.s.http.get('/api/stock/kardex')).status).toBe(400);
  });

  it('exporta y controla permisos', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const binario = (url: string) => t.s.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect((await binario('/api/stock/existencias?formato=xlsx')).headers['content-type']).toContain('spreadsheetml');
    expect((await binario(`/api/stock/kardex?articuloId=${a.id}&formato=pdf`)).headers['content-type']).toContain('pdf');
    expect((await binario('/api/stock/valuacion?fecha=2026-11-30&formato=xlsx')).headers['content-type']).toContain('spreadsheetml');
    const sin = await otroUsuario(app, prisma, t.s.empresaId, ['articulo.ver']);
    expect((await sin.http.get('/api/stock/existencias')).status).toBe(403);
  });
});
