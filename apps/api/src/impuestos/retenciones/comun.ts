import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { ContextoGeneracion } from '../presentaciones/generado';

/**
 * Retenciones practicadas con certificado y fecha de pago en el período: las de OP pagadas y no anuladas, y (E43) las anuladas
 * después del período, así regenerar un mes ya presentado da el mismo archivo.
 */
export function retencionesDelPeriodo(tx: TxEmpresa, ctx: ContextoGeneracion, filtro: Prisma.OrdenPagoRetencionWhereInput) {
  return tx.ordenPagoRetencion.findMany({
    where: {
      ...filtro, certificadoNumero: { not: null }, ordenPago: { fechaPago: { gte: ctx.desde, lte: ctx.hasta } },
      OR: [{ anulada: false, ordenPago: { estado: 'PAGADA' } }, { anulada: true, anuladaEn: { gt: ctx.hasta } }],
    },
    include: { ordenPago: { include: { tercero: true } } },
    orderBy: [{ ordenPago: { fechaPago: 'asc' } }, { certificadoNumero: 'asc' }],
  });
}

/** Junta las advertencias de cada línea. */
export function acumulador() {
  const advertencias: string[] = [];
  return { advertencias, tomar: (r: { texto: string; advertencias: string[] }) => (advertencias.push(...r.advertencias), r.texto) };
}

/**
 * Anulaciones a informar en el período (E43): retenciones con certificado anuladas en el período cuyo pago fue anterior
 * (las anuladas el mismo mes no se informaron). Las anuladas antes de la E43 no tienen fecha y no entran.
 */
export async function anulacionesDelPeriodo(tx: TxEmpresa, ctx: ContextoGeneracion, filtro: Prisma.OrdenPagoRetencionWhereInput) {
  const rets = await tx.ordenPagoRetencion.findMany({
    where: { ...filtro, anulada: true, certificadoNumero: { not: null }, anuladaEn: { gte: ctx.desde, lte: ctx.hasta }, ordenPago: { fechaPago: { lt: ctx.desde } } },
    include: { ordenPago: { include: { tercero: true } } },
    orderBy: [{ anuladaEn: 'asc' }, { certificadoNumero: 'asc' }],
  });
  const sinCertificado = rets.find((r) => !r.certificadoSire);
  if (sinCertificado)
    throw new BadRequestException(`Cargue el número de certificado SIRE de la retención ${sinCertificado.certificadoNumero} (${sinCertificado.ordenPago.tercero.razonSocial}) para informar su anulación`);
  return rets;
}
