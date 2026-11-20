import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

/**
 * Un mes con la posición de IVA cerrada cierra sus libros (spec E37 §6): no se confirma ni se anula una compra con fecha contable
 * en ese mes ni se emite una venta con fecha en ese mes, así un comprobante tardío no queda fuera de toda liquidación.
 */
export async function verificarMesIvaAbierto(tx: TxEmpresa, empresaId: string, fecha: Date): Promise<void> {
  // Lock compartido (revisión E37): el cierre toma el exclusivo, así espera a las operaciones en curso y las siguientes ven el cierre
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock_shared(hashtext($1))', `posicion-iva:${empresaId}`);
  const anio = fecha.getUTCFullYear(), mes = fecha.getUTCMonth() + 1;
  if (await tx.posicionIva.findFirst({ where: { anio, mes }, select: { id: true } }))
    throw new BadRequestException(`La posición de IVA de ${String(mes).padStart(2, '0')}/${anio} está cerrada: use una fecha de un mes abierto o reabra la posición`);
}
