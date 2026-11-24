import { Prisma } from '@prisma/client';
import { TxEmpresa } from '../../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/**
 * E52: costo en pesos de cada artículo. Último comprobante de compra confirmado de tipo factura o tique con renglones del artículo
 * (por fecha de emisión y número interno): Σ importe × cotización ÷ Σ cantidad. Sin compras, el costo promedio de stock si es mayor que cero.
 */
export async function costosDeArticulos(tx: TxEmpresa, articuloIds: string[]): Promise<Map<string, Dec>> {
  const res = new Map<string, Dec>();
  if (!articuloIds.length) return res;
  const renglones = await tx.comprobanteCompraRenglon.findMany({
    where: { articuloId: { in: articuloIds }, comprobante: { estado: 'CONFIRMADO', tipo: { in: ['FACTURA', 'TICKET'] } } },
    include: { comprobante: { select: { id: true, fechaEmision: true, numeroInterno: true, cotizacion: true } } },
  });
  const porArticulo = new Map<string, typeof renglones>();
  for (const r of renglones) porArticulo.set(r.articuloId!, [...(porArticulo.get(r.articuloId!) ?? []), r]);
  for (const [articuloId, rs] of porArticulo) {
    const ultimo = rs.reduce((m, r) => {
      const a = m.comprobante, b = r.comprobante;
      return b.fechaEmision > a.fechaEmision || (b.fechaEmision.getTime() === a.fechaEmision.getTime() && b.numeroInterno > a.numeroInterno) ? r : m;
    }).comprobante.id;
    const del = rs.filter((r) => r.comprobante.id === ultimo);
    const cantidad = del.reduce((s, r) => s.plus(r.cantidad), new D(0));
    if (cantidad.gt(0)) res.set(articuloId, del.reduce((s, r) => s.plus(new D(r.importe).times(r.comprobante.cotizacion)), new D(0)).div(cantidad));
  }
  const faltan = articuloIds.filter((id) => !res.has(id));
  if (faltan.length)
    for (const a of await tx.articulo.findMany({ where: { id: { in: faltan } }, select: { id: true, costoPromedio: true } }))
      if (new D(a.costoPromedio).gt(0)) res.set(a.id, new D(a.costoPromedio));
  return res;
}
