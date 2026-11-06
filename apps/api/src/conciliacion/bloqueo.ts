import { BadRequestException } from '@nestjs/common';
import { bloquear, fechaAR } from '../compras/comun';
import type { TxEmpresa } from '../prisma/tenant-prisma.service';

/** Elimina un vínculo: sus líneas vuelven a PENDIENTE y sus movimientos quedan sin conciliar. */
export async function desvincular(tx: TxEmpresa, vinculoId: string): Promise<void> {
  await tx.lineaExtracto.updateMany({ where: { vinculoId }, data: { estado: 'PENDIENTE', vinculoId: null, conciliacionId: null } });
  await tx.movimientoTesoreria.updateMany({ where: { vinculoId }, data: { vinculoId: null } });
  await tx.vinculoConciliacion.deleteMany({ where: { id: vinculoId } });
}

/**
 * Antes de anular los movimientos de banco de un origen: si alguno está conciliado en una conciliación
 * cerrada, 400; si está en una abierta, se desvincula (la línea del extracto vuelve a pendiente).
 */
/** Bloquea la conciliación abierta de la cuenta (si hay): serializa con vincular, cerrar y registrar. */
async function bloquearAbierta(tx: TxEmpresa, cuentaBancariaId: string): Promise<void> {
  const abierta = await tx.conciliacion.findFirst({ where: { cuentaBancariaId, estado: 'ABIERTA' }, select: { id: true, empresaId: true } });
  if (abierta) await bloquear(tx, 'Conciliacion', abierta.empresaId, [abierta.id]);
}

export async function liberarOVerificar(tx: TxEmpresa, origenTipo: string, origenId: string): Promise<void> {
  const cuentas = await tx.movimientoTesoreria.findMany({ where: { origenTipo, origenId, anulado: false, cuentaBancariaId: { not: null } }, select: { cuentaBancariaId: true } });
  for (const id of [...new Set(cuentas.map((c) => c.cuentaBancariaId!))].sort()) await bloquearAbierta(tx, id);
  // Se relee con la conciliación bloqueada
  const movs = await tx.movimientoTesoreria.findMany({ where: { origenTipo, origenId, anulado: false, vinculoId: { not: null } } });
  for (const vinculoId of new Set(movs.map((m) => m.vinculoId!))) {
    const v = await tx.vinculoConciliacion.findUnique({ where: { id: vinculoId } });
    if (!v) continue;
    const c = await tx.conciliacion.findUniqueOrThrow({ where: { id: v.conciliacionId } });
    if (c.estado === 'CERRADA')
      throw new BadRequestException(`El movimiento está conciliado en la conciliación del período ${fechaAR(c.desde)}–${fechaAR(c.hasta)}: reábrala para anularlo`);
    await desvincular(tx, vinculoId);
  }
}

/** No se registran movimientos de banco con fecha dentro de un período ya conciliado y cerrado. */
export async function verificarFechaAbierta(tx: TxEmpresa, cuentaBancariaId: string, fecha: Date): Promise<void> {
  await bloquearAbierta(tx, cuentaBancariaId);
  const ultima = await tx.conciliacion.findFirst({ where: { cuentaBancariaId, estado: 'CERRADA' }, orderBy: { hasta: 'desc' } });
  if (ultima && fecha <= ultima.hasta) throw new BadRequestException(`La cuenta está conciliada hasta ${fechaAR(ultima.hasta)}`);
}
