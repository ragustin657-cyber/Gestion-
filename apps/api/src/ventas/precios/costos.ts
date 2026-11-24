import { Prisma } from '@prisma/client';
import { TxEmpresa } from '../../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/**
 * E52: costo en pesos de cada artículo. Último comprobante de compra confirmado de tipo factura o tique con renglones del artículo
 * (por fecha de emisión y número interno): Σ importe × cotización ÷ Σ cantidad. Sin compras, el costo promedio de stock si es mayor que cero.
 */
export async function costosDeArticulos(tx: TxEmpresa, articuloIds: string[], empresaId: string): Promise<Map<string, Dec>> {
  const res = new Map<string, Dec>();
  if (!articuloIds.length) return res;
  // Revisión E52: solo el último comprobante de cada artículo (no todo el historial de compras)
  const ultimos = await tx.$queryRaw<{ articuloId: string; comprobanteId: string }[]>`
    SELECT DISTINCT ON (r."articuloId") r."articuloId" AS "articuloId", c."id" AS "comprobanteId"
    FROM "ComprobanteCompraRenglon" r JOIN "ComprobanteCompra" c ON c."id" = r."comprobanteId"
    WHERE c."empresaId" = ${empresaId}::uuid AND c."estado" = 'CONFIRMADO' AND c."tipo" IN ('FACTURA', 'TICKET') AND r."articuloId" = ANY(${articuloIds}::uuid[])
    ORDER BY r."articuloId", c."fechaEmision" DESC, c."numeroInterno" DESC`;
  const renglones = ultimos.length ? await tx.comprobanteCompraRenglon.findMany({
    where: { articuloId: { in: ultimos.map((u) => u.articuloId) }, comprobanteId: { in: [...new Set(ultimos.map((u) => u.comprobanteId))] } },
    include: { comprobante: { select: { id: true, fechaEmision: true, numeroInterno: true, cotizacion: true } } },
  }) : [];
  const ultimoDe = new Map(ultimos.map((u) => [u.articuloId, u.comprobanteId]));
  const porArticulo = new Map<string, typeof renglones>();
  for (const r of renglones) porArticulo.set(r.articuloId!, [...(porArticulo.get(r.articuloId!) ?? []), r]);
  for (const [articuloId, rs] of porArticulo) {
    const del = rs.filter((r) => r.comprobante.id === ultimoDe.get(articuloId));
    const cantidad = del.reduce((s, r) => s.plus(r.cantidad), new D(0));
    const costo = cantidad.gt(0) ? del.reduce((s, r) => s.plus(new D(r.importe).times(r.comprobante.cotizacion)), new D(0)).div(cantidad) : new D(0);
    // Revisión E52: un costo cero (compra bonificada al 100 %) no sirve: se usa el promedio o queda sin costo
    if (costo.gt(0)) res.set(articuloId, costo);
  }
  const faltan = articuloIds.filter((id) => !res.has(id));
  if (faltan.length)
    for (const a of await tx.articulo.findMany({ where: { id: { in: faltan } }, select: { id: true, costoPromedio: true } }))
      if (new D(a.costoPromedio).gt(0)) res.set(a.id, new D(a.costoPromedio));
  return res;
}
