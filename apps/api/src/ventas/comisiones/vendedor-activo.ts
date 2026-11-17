import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

/** Vendedor existente y activo, o 400 `Vendedor inválido` (E24 §4). */
export async function vendedorActivo(tx: TxEmpresa, id: string) {
  const v = await tx.vendedor.findUnique({ where: { id } });
  if (!v || !v.activo) throw new BadRequestException('Vendedor inválido');
  return v;
}
