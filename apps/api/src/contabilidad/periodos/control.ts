import { BadRequestException } from '@nestjs/common';
import type { Ejercicio, PeriodoContable } from '@prisma/client';
import { bloquear, fechaAR } from '../../compras/comun';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

/**
 * Ejercicio y período de una fecha, con el período bloqueado hasta el fin de la transacción.
 * 400 si no hay ejercicio, si el ejercicio está cerrado o si el período está cerrado.
 */
export async function periodoAbierto(tx: TxEmpresa, empresaId: string, fecha: Date): Promise<{ ejercicio: Ejercicio; periodo: PeriodoContable }> {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const previo = await tx.periodoContable.findFirst({ where: { anio, mes } });
  if (!previo) throw new BadRequestException(`No hay un ejercicio contable para la fecha ${fechaAR(fecha)}`);
  await bloquear(tx, 'PeriodoContable', empresaId, [previo.id]);
  const periodo = await tx.periodoContable.findUniqueOrThrow({ where: { id: previo.id } });
  const ejercicio = await tx.ejercicio.findUniqueOrThrow({ where: { id: periodo.ejercicioId } });
  if (ejercicio.estado === 'CERRADO') throw new BadRequestException(`El ejercicio ${ejercicio.numero} está cerrado`);
  if (periodo.estado === 'CERRADO') throw new BadRequestException(`El período ${String(mes).padStart(2, '0')}/${anio} está cerrado`);
  return { ejercicio, periodo };
}
