import { Prisma } from '@prisma/client';
import { TxEmpresa } from '../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export interface FilaReserva { pedidoId: string; numero: number; fecha: Date; terceroId: string; depositoId: string; articuloId: string; cantidad: Dec }

/** Depósito por defecto de un pedido sin depósito: el del primer punto de venta que tenga uno (como la confirmación). */
export async function depositoPorDefecto(tx: TxEmpresa): Promise<string | null> {
  return (await tx.puntoVenta.findFirst({ where: { depositoId: { not: null } }, orderBy: { numero: 'asc' } }))?.depositoId ?? null;
}

/**
 * E53: lo reservado por los pedidos confirmados o entregados en parte: cantidad − máx(entregado, facturado) de cada renglón
 * de artículos que controlan stock, en el depósito del pedido (o el por defecto). Calculado en el momento, sin tabla.
 */
export async function reservado(tx: TxEmpresa, f: { articuloIds?: string[]; depositoId?: string; excluirPedidoIds?: string[] } = {}): Promise<FilaReserva[]> {
  const renglones = await tx.pedidoVentaRenglon.findMany({
    where: {
      articuloId: f.articuloIds ? { in: f.articuloIds } : { not: null },
      pedido: { estado: { in: ['CONFIRMADO', 'PARCIALMENTE_ENTREGADO'] }, ...(f.excluirPedidoIds?.length ? { id: { notIn: f.excluirPedidoIds } } : {}) },
    },
    include: { pedido: { select: { id: true, numero: true, fecha: true, terceroId: true, depositoId: true } } },
  });
  if (!renglones.length) return [];
  const conStock = new Set((await tx.articulo.findMany({ where: { id: { in: [...new Set(renglones.map((r) => r.articuloId!))] }, controlaStock: true }, select: { id: true } })).map((a) => a.id));
  const defecto = renglones.some((r) => !r.pedido.depositoId) ? await depositoPorDefecto(tx) : null;
  const filas: FilaReserva[] = [];
  for (const r of renglones) {
    if (!conStock.has(r.articuloId!)) continue;
    const depositoId = r.pedido.depositoId ?? defecto;
    if (!depositoId || (f.depositoId && depositoId !== f.depositoId)) continue;
    const pendiente = new D(r.cantidad).minus(D.max(r.cantidadEntregada, r.cantidadFacturada));
    if (pendiente.gt(0)) filas.push({ pedidoId: r.pedido.id, numero: r.pedido.numero, fecha: r.pedido.fecha, terceroId: r.pedido.terceroId, depositoId, articuloId: r.articuloId!, cantidad: pendiente });
  }
  return filas;
}

export const totalReservado = (filas: FilaReserva[], articuloId: string, depositoId: string): Dec =>
  filas.filter((x) => x.articuloId === articuloId && x.depositoId === depositoId).reduce((s, x) => s.plus(x.cantidad), new D(0));

/**
 * Avisos de disponible (nunca bloquean): por artículo, si lo pedido supera stock − reservado por otros pedidos.
 * Con `soloSiAlcanzaElStock`, no avisa cuando el stock solo ya no alcanza (ese aviso lo da el control de stock).
 */
export async function avisosDisponible(tx: TxEmpresa, o: { depositoId: string; cantidades: Map<string, Dec>; excluirPedidoIds: string[]; cola: (q: Dec) => string; soloSiAlcanzaElStock?: boolean }): Promise<string[]> {
  const ids = [...o.cantidades.keys()];
  if (!ids.length) return [];
  const arts = await tx.articulo.findMany({ where: { id: { in: ids }, controlaStock: true }, orderBy: { codigo: 'asc' } });
  if (!arts.length) return [];
  const deposito = await tx.deposito.findUnique({ where: { id: o.depositoId } });
  if (!deposito) return [];
  const filas = await reservado(tx, { articuloIds: arts.map((a) => a.id), depositoId: o.depositoId, excluirPedidoIds: o.excluirPedidoIds });
  const avisos: string[] = [];
  for (const a of arts) {
    const q = o.cantidades.get(a.id)!;
    const stock = new D((await tx.saldoStock.findFirst({ where: { articuloId: a.id, depositoId: o.depositoId } }))?.cantidad ?? 0);
    const r = totalReservado(filas, a.id, o.depositoId);
    const disponible = stock.minus(r);
    if (!q.gt(disponible)) continue;
    if (o.soloSiAlcanzaElStock && stock.lt(q)) continue;
    avisos.push(`Disponible de ${a.codigo} en ${deposito.nombre}: stock ${stock.toString()}, reservado por otros pedidos ${r.toString()}, disponible ${disponible.toString()}; ${o.cola(q)}`);
  }
  return avisos;
}
