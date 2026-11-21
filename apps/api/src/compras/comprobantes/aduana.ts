import { BadRequestException } from '@nestjs/common';
import type { Tercero } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

/** Dirección General de Aduanas (E41). */
export const CUIT_ADUANA = '33693450239';

/** El tercero de la Aduana: el de la empresa con ese CUIT, o se crea (exento, proveedor). Uno inactivo o no proveedor se rechaza. */
export async function terceroAduana(tx: TxEmpresa, empresaId: string, siguienteCodigo: () => Promise<number>): Promise<Tercero> {
  const t = await tx.tercero.findFirst({ where: { cuit: CUIT_ADUANA } });
  if (t) {
    if (!t.activo || !t.esProveedor) throw new BadRequestException(`El tercero con el CUIT de la Aduana (${t.razonSocial}) no es un proveedor activo: actívelo o márquelo como proveedor`);
    return t;
  }
  // Mismo correlativo que el alta de terceros; se saltean códigos ya usados (por ejemplo, cargados por importación)
  let codigo = await siguienteCodigo();
  while (await tx.tercero.findFirst({ where: { codigo }, select: { id: true } })) codigo = await siguienteCodigo();
  return tx.tercero.create({
    data: {
      empresaId, codigo, razonSocial: 'Dirección General de Aduanas', cuit: CUIT_ADUANA, condicionIva: 'EXENTO',
      esProveedor: true, exentoGanancias: true, diasPago: 0,
    },
  });
}
