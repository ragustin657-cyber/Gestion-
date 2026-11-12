import { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** Valor de stock por artículo (kardex con fecha ≤ fecha o < fecha). */
export async function valorStock(tx: TxEmpresa, fecha: Date, inclusive = true): Promise<Map<string, Dec>> {
  const g = await tx.movimientoStock.groupBy({ by: ['articuloId'], where: { fecha: inclusive ? { lte: fecha } : { lt: fecha } }, _sum: { importe: true } });
  return new Map(g.map((x) => [x.articuloId, new D(x._sum.importe ?? 0)]));
}
