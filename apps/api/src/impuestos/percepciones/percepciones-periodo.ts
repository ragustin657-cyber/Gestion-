import { Prisma } from '@prisma/client';
import { numeroVenta } from '../../ventas/comprobantes/comprobantes.service';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ventasDelAmbiente } from '../libros-iva/libro-ventas.service';

const D = Prisma.Decimal;

/** Percepciones practicadas (E39) en ventas autorizadas del ambiente vigente con fecha en el período, con importes en pesos y signo (la NC resta). */
export async function percepcionesDelPeriodo(tx: TxEmpresa, desde: Date, hasta: Date, filtro: { tipo?: 'IIBB' | 'IVA'; jurisdiccion?: string } = {}) {
  const { ambiente } = await ventasDelAmbiente(tx, desde, hasta);
  const ps = await tx.comprobanteVentaPercepcion.findMany({
    where: { ...(filtro.tipo ? { tipo: filtro.tipo } : {}), ...(filtro.jurisdiccion ? { jurisdiccion: filtro.jurisdiccion } : {}), comprobante: { estado: 'AUTORIZADO', ambiente, fecha: { gte: desde, lte: hasta } } },
    include: { comprobante: { include: { tercero: true } } },
  });
  return ps
    .map((p) => {
      const c = p.comprobante, s = c.tipo === 'NOTA_CREDITO' ? -1 : 1;
      const pesos = (x: Prisma.Decimal) => x.mul(c.cotizacion).toDecimalPlaces(2);
      return {
        p, c, signo: s, basePesos: pesos(p.base), importePesos: pesos(p.importe),
        comprobante: `${c.tipo === 'FACTURA' ? 'Factura' : c.tipo === 'NOTA_DEBITO' ? 'Nota de débito' : 'Nota de crédito'} ${c.letra} ${numeroVenta(c.puntoVenta, c.numero)}`,
      };
    })
    .sort((a, b) => a.c.fecha.getTime() - b.c.fecha.getTime() || a.c.puntoVenta - b.c.puntoVenta || (a.c.numero ?? 0) - (b.c.numero ?? 0) || a.c.tipo.localeCompare(b.c.tipo));
}

export const totalPercepciones = (filas: { importePesos: Prisma.Decimal; signo: number }[]) => filas.reduce((t, f) => t.plus(f.importePesos.mul(f.signo)), new D(0));
