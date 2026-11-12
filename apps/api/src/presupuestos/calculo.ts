import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Reparte un total en partes iguales a 2 decimales; el último mes absorbe el redondeo. */
export function repartir(total: Dec, meses: string[]): Record<string, Dec> {
  const parte = new D(total).div(meses.length).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const r: Record<string, Dec> = {};
  meses.forEach((m, i) => { r[m] = i === meses.length - 1 ? new D(total).minus(parte.times(meses.length - 1)) : parte; });
  return r;
}
