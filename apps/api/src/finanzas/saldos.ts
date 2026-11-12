import { Prisma } from '@prisma/client';
import { ORIGENES_CLIENTE } from '../compras/comun';
import type { TxEmpresa } from '../prisma/tenant-prisma.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export interface SaldoMovimiento {
  movimientoId: string; terceroId: string; origenTipo: string; origenId: string;
  fecha: Date; fechaVencimiento: Date; monedaCodigo: string; importePesos: Dec; saldoPesos: Dec;
}

/**
 * Saldo pendiente en pesos de cada movimiento de cuenta corriente a una fecha (spec E15 §2):
 * importe − pagos aplicados (compras) − cobros aplicados como débito + consumos como crédito, con aplicaciones vigentes hasta el corte.
 */
export async function saldosAFecha(tx: TxEmpresa, tipo: 'clientes' | 'proveedores', corte: Date): Promise<SaldoMovimiento[]> {
  const movs = await tx.movimientoCuentaCorriente.findMany({
    where: { anulado: false, fecha: { lte: corte }, origenTipo: tipo === 'clientes' ? { in: ORIGENES_CLIENTE } : { notIn: ORIGENES_CLIENTE } },
    select: { id: true, terceroId: true, origenTipo: true, origenId: true, fecha: true, fechaVencimiento: true, monedaCodigo: true, importePesos: true },
  });
  if (!movs.length) return [];
  const hasta = { fecha: { lte: corte }, anulada: false };
  const [pagos, debitos, creditos] = await Promise.all([
    tx.aplicacionCuentaCorriente.groupBy({ by: ['movimientoId'], where: hasta, _sum: { importePesosHistorico: true } }),
    tx.aplicacionCobro.groupBy({ by: ['debitoMovId'], where: hasta, _sum: { importePesosDebito: true } }),
    tx.aplicacionCobro.groupBy({ by: ['creditoMovId'], where: hasta, _sum: { importePesosCredito: true } }),
  ]);
  const ajuste = new Map<string, Dec>();
  const sumar = (id: string, v: Prisma.Decimal | null) => ajuste.set(id, (ajuste.get(id) ?? new D(0)).plus(v ?? 0));
  for (const p of pagos) sumar(p.movimientoId, new D(p._sum.importePesosHistorico ?? 0).neg());
  for (const d of debitos) sumar(d.debitoMovId, new D(d._sum.importePesosDebito ?? 0).neg());
  for (const c of creditos) sumar(c.creditoMovId, new D(c._sum.importePesosCredito ?? 0));
  return movs
    .map(({ id, ...m }) => ({ movimientoId: id, ...m, importePesos: new D(m.importePesos), saldoPesos: new D(m.importePesos).plus(ajuste.get(id) ?? 0) }))
    .filter((m) => !m.saldoPesos.isZero());
}
