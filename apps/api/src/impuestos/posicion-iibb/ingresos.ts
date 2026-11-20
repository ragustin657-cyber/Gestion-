import { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ventasDelAmbiente } from '../libros-iva/libro-ventas.service';

const D = Prisma.Decimal;

/**
 * Ingresos gravados de IIBB (spec E38 §4): neto gravado + no gravado + exento, en pesos por la cotización, de las ventas
 * autorizadas del ambiente vigente; las notas de crédito restan. Devuelve el importe por cliente y los avisos de ventas omitidas.
 */
export async function ingresosGravados(tx: TxEmpresa, desde: Date, hasta: Date): Promise<{ porTercero: Map<string, Prisma.Decimal>; total: Prisma.Decimal; avisos: string[] }> {
  const { ambiente, omitidos } = await ventasDelAmbiente(tx, desde, hasta);
  const comps = await tx.comprobanteVenta.findMany({
    where: { estado: 'AUTORIZADO', ambiente, fecha: { gte: desde, lte: hasta } },
    select: { tipo: true, terceroId: true, netoGravado: true, noGravado: true, exento: true, cotizacion: true },
  });
  const porTercero = new Map<string, Prisma.Decimal>();
  let total = new D(0);
  for (const c of comps) {
    const v = c.netoGravado.plus(c.noGravado).plus(c.exento).times(c.cotizacion).toDecimalPlaces(2, D.ROUND_HALF_UP).times(c.tipo === 'NOTA_CREDITO' ? -1 : 1);
    porTercero.set(c.terceroId, (porTercero.get(c.terceroId) ?? new D(0)).plus(v));
    total = total.plus(v);
  }
  return { porTercero, total, avisos: omitidos };
}
