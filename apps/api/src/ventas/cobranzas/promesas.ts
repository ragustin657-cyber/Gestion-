import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
export type EstadoPromesa = 'CUMPLIDA' | 'INCUMPLIDA' | 'PENDIENTE';

/**
 * Estado de una promesa de pago (spec E25 §6): lo cobrado desde la gestión (y antes de la gestión que la reemplazó)
 * menos los cheques rechazados en ese lapso; cumplida si alcanza el importe, incumplida si venció sin alcanzarlo.
 */
export function estadoPromesa(
  p: { fecha: Date; importe: Dec; desde: Date; hasta: Date | null },
  movimientos: { origenTipo: string; fecha: Date; importePesos: Dec }[],
  hoy: Date,
): EstadoPromesa {
  const enRango = movimientos.filter((m) => m.fecha >= p.desde && (!p.hasta || m.fecha < p.hasta));
  const cobrado = enRango.reduce((s, m) => {
    if (m.origenTipo === 'RECIBO' || m.origenTipo === 'COBRO') return s.minus(m.importePesos);
    if (m.origenTipo === 'CHEQUE_RECHAZADO_CLIENTE') return s.minus(m.importePesos);
    return s;
  }, new Prisma.Decimal(0));
  if (cobrado.gte(p.importe)) return 'CUMPLIDA';
  return p.fecha < hoy ? 'INCUMPLIDA' : 'PENDIENTE';
}
