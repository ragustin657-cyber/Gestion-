import type { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { ContextoGeneracion } from '../presentaciones/generado';

/** Retenciones practicadas en OP pagadas, no anuladas y con certificado, con fecha de pago en el período. */
export function retencionesDelPeriodo(tx: TxEmpresa, ctx: ContextoGeneracion, filtro: Prisma.OrdenPagoRetencionWhereInput) {
  return tx.ordenPagoRetencion.findMany({
    where: { ...filtro, anulada: false, certificadoNumero: { not: null }, ordenPago: { estado: 'PAGADA', fechaPago: { gte: ctx.desde, lte: ctx.hasta } } },
    include: { ordenPago: { include: { tercero: true } } },
    orderBy: [{ ordenPago: { fechaPago: 'asc' } }, { certificadoNumero: 'asc' }],
  });
}

/** Junta las advertencias de cada línea. */
export function acumulador() {
  const advertencias: string[] = [];
  return { advertencias, tomar: (r: { texto: string; advertencias: string[] }) => (advertencias.push(...r.advertencias), r.texto) };
}
