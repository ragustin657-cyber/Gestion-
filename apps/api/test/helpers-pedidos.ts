import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { prepararStock } from './helpers-stock';
import { prepararVentas } from './helpers-ventas';

/** Ventas con stock: pedidos y remitos sobre el cliente RI y el depósito Central. */
export async function prepararPedidos(app: INestApplication, prisma: PrismaService) {
  const v = await prepararVentas(app, prisma);
  const t = await prepararStock(app, prisma, v);
  await v.http.patch(`/api/empresas/actual/puntos-venta/${v.puntoVenta.id}`, { depositoId: t.deposito.id });
  const renglon = (articuloId: string | null, cantidad: number, precioUnitario = 1000) => ({ articuloId, descripcion: 'Producto', cantidad, precioUnitario, alicuota: 21 });
  const pedido = async (renglones: ReturnType<typeof renglon>[], o: Record<string, unknown> = {}) => {
    const r = await v.http.post('/api/ventas/pedidos', { terceroId: v.clienteRI.id, fecha: '2026-11-02', monedaCodigo: 'ARS', depositoId: t.deposito.id, renglones, ...o });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body as { id: string; numero: number; version: number; estado: string; renglones: { id: string; articuloId: string | null }[] };
  };
  const remito = (renglones: Record<string, unknown>[], o: Record<string, unknown> = {}) =>
    v.http.post('/api/ventas/remitos', { terceroId: v.clienteRI.id, puntoVentaId: v.puntoVenta.id, fecha: '2026-11-03', depositoId: t.deposito.id, renglones, ...o });
  const dePedido = (pedidoRenglonId: string, cantidad: number) => ({ pedidoRenglonId, cantidad });
  const pdfTexto = async (url: string) => {
    const r = await v.http.get(url).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
    return { status: r.status, tipo: r.headers['content-type'] as string, texto: (r.body as Buffer).toString('latin1') };
  };
  return { ...v, ...t, renglon, pedido, remito, dePedido, pdfTexto };
}
