import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase } from './helpers';
import { prepararPedidos } from './helpers-pedidos';

const aviso = (cod: string, s: number, r: number, d: number, cola: string) => `Disponible de ${cod} en Central: stock ${s}, reservado por otros pedidos ${r}, disponible ${d}; ${cola}`;

describe('reservas de stock (E53)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const escenario = async () => {
    const e = await prepararPedidos(app, prisma);
    const art = await e.articulo();
    await e.inicial(art.id, 10, 100);
    const confirmado = async (cantidad: number) => {
      const p = await e.pedido([e.renglon(art.id, cantidad)]);
      const c = await e.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
      if (c.status !== 201) throw new Error(JSON.stringify(c.body));
      return { ...p, advertencias: c.body.advertencias as string[] };
    };
    const factura = (renglones: Record<string, unknown>[], emitir = true) => e.http.post('/api/ventas/comprobantes', { ...e.datos({ renglones }), emitir });
    return { ...e, art, confirmado, factura };
  };

  it('confirmar y remitir avisan lo reservado por otros pedidos', async () => {
    const x = await escenario();
    const a = await x.confirmado(8);
    expect(a.advertencias).toEqual([]);
    const b = await x.confirmado(5);
    expect(b.advertencias).toEqual([aviso(x.art.codigo, 10, 8, 2, 'el pedido pide 5')]);
    const rb = await x.remito([x.dePedido(b.renglones[0].id, 5)]);
    expect(rb.status).toBe(201);
    expect(rb.body.advertencias).toEqual([aviso(x.art.codigo, 10, 8, 2, 'se entregan 5')]);
    // El propio pedido no avisa por su reserva
    const ra = await x.remito([x.dePedido(a.renglones[0].id, 3)]);
    expect(ra.body.advertencias).toEqual([]);
  });

  it('remitido en dos partes deja de reservar; anulado y cerrado no reservan', async () => {
    const x = await escenario();
    const a = await x.confirmado(8);
    await x.remito([x.dePedido(a.renglones[0].id, 3)]);
    // Stock 7, reservado 5: un pedido de 1 entra en lo disponible
    expect((await x.confirmado(1)).advertencias).toEqual([]);
    await x.remito([x.dePedido(a.renglones[0].id, 5)]);
    // Stock 2; reservado: solo el pedido de 1 → otro de 1 no avisa
    const c = await x.confirmado(1);
    expect(c.advertencias).toEqual([]);
    await x.http.post(`/api/ventas/pedidos/${c.id}/cerrar`, { motivo: 'x' });
    const d = await x.confirmado(1);
    await x.http.post(`/api/ventas/pedidos/${d.id}/anular`, { motivo: 'x' });
    // Reservado: solo el primero de 1 (stock 2) → otro de 1 no avisa; de 2 sí
    expect((await x.confirmado(1)).advertencias).toEqual([]);
    expect((await x.confirmado(1)).advertencias).toEqual([aviso(x.art.codigo, 2, 2, 0, 'el pedido pide 1')]);
  });

  it('factura directa avisa; con BLOQUEAR igual se emite', async () => {
    const x = await escenario();
    await x.confirmado(8);
    // Los avisos salen al guardar el comprobante (la pantalla los muestra antes de emitir)
    let f = await x.factura([{ articuloId: x.art.id, descripcion: 'x', cantidad: 3, precioUnitario: 1000, alicuota: 21 }], false);
    expect([f.status, f.body.advertencias]).toEqual([201, [aviso(x.art.codigo, 10, 8, 2, 'se entregan 3')]]);
    expect((await x.http.post(`/api/ventas/comprobantes/${f.body.id}/emitir`)).status).toBe(201);
    await x.modo('BLOQUEAR');
    f = await x.factura([{ articuloId: x.art.id, descripcion: 'x', cantidad: 2, precioUnitario: 1000, alicuota: 21 }], false);
    expect([f.status, f.body.advertencias]).toEqual([201, [aviso(x.art.codigo, 7, 8, -1, 'se entregan 2')]]);
    expect((await x.http.post(`/api/ventas/comprobantes/${f.body.id}/emitir`)).status).toBe(201);
  });

  it('pedido sin depósito y sin puntos de venta con depósito: no reserva', async () => {
    const x = await escenario();
    await prisma.puntoVenta.updateMany({ where: { empresaId: x.empresaId }, data: { depositoId: null } });
    const p = await x.pedido([x.renglon(x.art.id, 8)], { depositoId: null });
    const c = await x.http.post(`/api/ventas/pedidos/${p.id}/confirmar`, {});
    expect([c.status, c.body.advertencias]).toEqual([201, []]);
  });
});
