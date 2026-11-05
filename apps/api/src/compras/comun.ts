import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { esAlicuotaIva } from '@gestion/shared';

/** Fecha 'YYYY-MM-DD' → Date a medianoche UTC. */
export const zFecha = z
  .string({ required_error: 'Campo obligatorio' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Fecha inválida');

export const zRenglonBase = z.object({
  articuloId: z.string().uuid().nullish(),
  descripcion: z.string().trim().min(1),
  cantidad: z.number().gt(0, 'Debe ser mayor a cero'),
  precioUnitario: z.number().min(0, 'No puede ser negativo'),
  bonificacionPct: z.number().min(0).max(100).default(0),
  alicuotaIva: z.number().refine(esAlicuotaIva, 'Alícuota de IVA inválida'),
  centroCostoId: z.string().uuid().nullish(),
});

export const zVersion = z.object({ version: z.number().int().min(0) });
export const zMotivo = z.string().trim().min(1, 'Debe indicar el motivo');

export const MODIFICADO = 'El comprobante fue modificado por otro usuario';

/** Interpreta un updateMany con bloqueo optimista que no afectó filas. */
export function errorTransicion(actual: { version: number } | null, version: number, mensajeEstado: string): never {
  if (!actual) throw new NotFoundException('Registro no encontrado');
  if (actual.version !== version) throw new ConflictException(MODIFICADO);
  throw new BadRequestException(mensajeEstado);
}

const fechaAR = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
export { fechaAR };

import type { TxEmpresa } from '../prisma/tenant-prisma.service';

/** Bloquea filas (SELECT … FOR UPDATE) de la empresa hasta el fin de la transacción. */
export async function bloquear(
  tx: TxEmpresa, tabla: 'OrdenCompraRenglon' | 'InformeRecepcionRenglon' | 'OrdenPago' | 'Tercero' | 'MovimientoCuentaCorriente' | 'Chequera', empresaId: string, ids: string[],
): Promise<void> {
  if (!ids.length) return;
  await tx.$queryRawUnsafe(
    `SELECT id FROM "${tabla}" WHERE id = ANY($1::uuid[]) AND "empresaId" = $2::uuid ORDER BY id FOR UPDATE`,
    ids, empresaId,
  );
}
