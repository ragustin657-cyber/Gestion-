import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararStock } from './helpers-stock';

describe('stock: motor, inventario inicial y salida manual', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const movs = (origenId: string) => prisma.movimientoStock.findMany({ where: { origenId }, orderBy: { creadoEn: 'asc' } });

  it('inicial y salida al promedio', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    const i1 = await t.inicial(a.id, 100, 10);
    expect(i1.status).toBe(201);
    expect(i1.body.numero).toBe(1);
    expect(await t.renglonesAsiento(i1.body.asientoId)).toEqual([['1.1.05.001', 'D 1000.00'], ['3.2.01', 'H 1000.00']]);
    await t.inicial(a.id, 50, 13);
    expect(await t.estado(a.id)).toEqual({ cantidad: '150', valor: '1650', promedio: '11' });
    expect(await t.saldo(a.id)).toBe('150');
    const sal = await t.salida(a.id, 30);
    expect(sal.status).toBe(201);
    const [m] = await movs(sal.body.id);
    expect(m).toMatchObject({ tipo: 'SALIDA_MANUAL' });
    expect(m.importe.toString()).toBe('-330');
    expect(m.cantidad.toString()).toBe('-30');
    expect(await t.renglonesAsiento(sal.body.asientoId)).toEqual([['1.1.05.001', 'H 330.00'], ['5.2.01', 'D 330.00']]);
  });

  it('la salida que agota el stock deja el valor en cero', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 3, 10);
    await t.inicial(a.id, 3, 10.01);
    await t.salida(a.id, 1);
    await t.salida(a.id, 1);
    const ultima = await t.salida(a.id, 4);
    const [m] = await movs(ultima.body.id);
    expect(m.importe.toString()).toBe('-40.02');
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '0', valor: '0' });
  });

  it('bloquea el stock negativo', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const r = await t.salida(a.id, 12);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Stock insuficiente de ART-1 en Central: hay 10, se piden 12');
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '10', valor: '100' });
  });

  it('permite con aviso y regulariza al entrar', async () => {
    const t = await prepararStock(app, prisma);
    await t.modo('AVISAR');
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const r = await t.salida(a.id, 12);
    expect(r.status).toBe(201);
    expect(r.body.advertencias).toEqual(['Stock insuficiente de ART-1 en Central: hay 10, se piden 12']);
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '-2', valor: '-20' });
    const e = await t.inicial(a.id, 5, 12);
    expect(e.status).toBe(201);
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '3', valor: '36', promedio: '12' });
    const ms = await movs(e.body.id);
    expect(ms.map((m) => [m.tipo, m.importe.toString()])).toEqual([['INICIAL', '60'], ['REGULARIZACION', '-4']]);
    expect(await t.renglonesAsiento(e.body.asientoId)).toEqual([['1.1.05.001', 'D 56.00'], ['3.2.01', 'H 60.00'], ['5.1.01', 'D 4.00']]);
  });

  it('inicial sin asiento', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    const r = await t.inicial(a.id, 5, 10, { conAsiento: false, cuentaContableId: null });
    expect(r.status).toBe(201);
    expect(r.body.asientoId).toBeNull();
    expect(await movs(r.body.id)).toHaveLength(1);
  });

  it('anula un documento con el costo original', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const sal = await t.salida(a.id, 4);
    await t.inicial(a.id, 10, 40); // cambia el promedio: 6×10 + 400 = 460 / 16
    const r = await t.s.http.post(`/api/stock/documentos/${sal.body.id}/anular`, { motivo: 'Error' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ANULADO');
    const ms = await movs(sal.body.id);
    expect(ms.map((m) => [m.cantidad.toString(), m.importe.toString(), !!m.anulaAId])).toEqual([['-4', '-40', false], ['4', '40', true]]);
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '20', valor: '500' });
    expect(r.body.asientoAnulacionId).toBeTruthy();
    const otra = await t.s.http.post(`/api/stock/documentos/${sal.body.id}/anular`, { motivo: 'Error' });
    expect(otra.status).toBe(409);
    expect(otra.body.message).toBe('El documento ya está anulado');
  });

  it('dos salidas simultáneas sobre el último stock', async () => {
    for (let i = 0; i < 4; i++) {
      await limpiarBase(prisma);
      const t = await prepararStock(app, prisma);
      const a = await t.articulo();
      await t.inicial(a.id, 5, 10);
      const rs = await Promise.all([t.salida(a.id, 5), t.salida(a.id, 5)]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await t.estado(a.id)).toMatchObject({ cantidad: '0', valor: '0' });
    }
  });

  it('valida artículo y cuenta', async () => {
    const t = await prepararStock(app, prisma);
    await t.articulo();
    const sin = await t.articulo(false);
    expect((await t.inicial(sin.id, 1, 1)).body.message).toBe('El artículo ART-2 no controla stock');
    const a = await t.articulo();
    expect((await t.inicial(a.id, 1, 1, { cuentaContableId: null })).body.message).toBe('Indique la cuenta contable');
    expect((await t.inicial(a.id, 0, 1)).status).toBe(400);
  });
});
