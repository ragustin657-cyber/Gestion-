import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
export const REDONDEOS = ['0.01', '1', '10', '100'] as const;
export type Redondeo = (typeof REDONDEOS)[number];

/** Precio × (1 + porcentaje/100), al múltiplo más cercano del redondeo (mitad hacia arriba), nunca menos que un múltiplo. */
export function aumentar(precio: Dec, porcentaje: number, redondeo: Redondeo): Dec {
  const paso = new D(redondeo);
  const bruto = new D(precio).times(new D(1).plus(new D(porcentaje).div(100)));
  const n = bruto.div(paso).toDecimalPlaces(0, D.ROUND_HALF_UP);
  return D.max(n, 1).times(paso);
}
