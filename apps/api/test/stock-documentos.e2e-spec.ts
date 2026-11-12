import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararStock } from './helpers-stock';

describe('stock: transferencias e inventario físico', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('transfiere sin cambiar el costo', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const tr = await t.documento({ tipo: 'TRANSFERENCIA', depositoDestinoId: t.deposito2.id, renglones: [{ articuloId: a.id, cantidad: 4 }] });
    expect(tr.status).toBe(201);
    expect(tr.body.asientoId).toBeNull();
    expect([await t.saldo(a.id), await t.saldo(a.id, t.deposito2.id)]).toEqual(['6', '4']);
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '10', valor: '100', promedio: '10' });
    const ms = await prisma.movimientoStock.findMany({ where: { origenId: tr.body.id }, orderBy: { cantidad: 'asc' } });
    expect(ms.map((m) => [m.cantidad.toString(), m.importe.toString(), m.tipo])).toEqual([['-4', '-40', 'TRANSFERENCIA'], ['4', '40', 'TRANSFERENCIA']]);
    const igual = await t.documento({ tipo: 'TRANSFERENCIA', depositoDestinoId: t.deposito.id, renglones: [{ articuloId: a.id, cantidad: 1 }] });
    expect(igual.body.message).toBe('El depósito de destino debe ser distinto del de origen');
    const mucho = await t.documento({ tipo: 'TRANSFERENCIA', depositoDestinoId: t.deposito2.id, renglones: [{ articuloId: a.id, cantidad: 11 }] });
    expect(mucho.body.message).toBe('Stock insuficiente de ART-1 en Central: hay 6, se piden 11');
  });

  it('inventario físico con sobrante y faltante', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    const b = await t.articulo();
    const c = await t.articulo();
    await t.inicial(a.id, 10, 10);
    await t.inicial(b.id, 5, 20);
    await t.inicial(c.id, 2, 5);
    const inv = await t.documento({ tipo: 'INVENTARIO', renglones: [{ articuloId: a.id, cantidadContada: 12 }, { articuloId: b.id, cantidadContada: 4 }, { articuloId: c.id, cantidadContada: 2 }] });
    expect(inv.status).toBe(201);
    const ms = await prisma.movimientoStock.findMany({ where: { origenId: inv.body.id } });
    expect(ms.map((m) => [m.articuloId, m.cantidad.toString(), m.importe.toString()]).sort()).toEqual([[a.id, '2', '20'], [b.id, '-1', '-20']].sort());
    expect(await t.renglonesAsiento(inv.body.asientoId)).toEqual([['4.2.04', 'H 20.00'], ['5.2.06', 'D 20.00']]);
    const ren = inv.body.renglones.find((r: { articuloId: string }) => r.articuloId === a.id);
    expect(ren.cantidad).toBe('2');
  });

  it('sobrante de un artículo sin costo', async () => {
    const t = await prepararStock(app, prisma);
    await t.articulo();
    await t.articulo();
    const a = await t.articulo();
    const r = await t.documento({ tipo: 'INVENTARIO', renglones: [{ articuloId: a.id, cantidadContada: 3 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El artículo ART-3 no tiene costo: cárguelo con inventario inicial');
  });

  it('lista y anula', async () => {
    const t = await prepararStock(app, prisma);
    const a = await t.articulo();
    await t.inicial(a.id, 10, 10);
    const tr = await t.documento({ tipo: 'TRANSFERENCIA', depositoDestinoId: t.deposito2.id, renglones: [{ articuloId: a.id, cantidad: 4 }] });
    const lista = (await t.s.http.get('/api/stock/documentos?tipo=TRANSFERENCIA')).body;
    expect(lista.map((d: { numero: number; tipo: string }) => [d.numero, d.tipo])).toEqual([[2, 'TRANSFERENCIA']]);
    expect((await t.s.http.post(`/api/stock/documentos/${tr.body.id}/anular`, { motivo: 'Error' })).status).toBe(201);
    expect([await t.saldo(a.id), await t.saldo(a.id, t.deposito2.id)]).toEqual(['10', '0']);
    expect(await t.estado(a.id)).toMatchObject({ cantidad: '10', valor: '100' });
  });
});
