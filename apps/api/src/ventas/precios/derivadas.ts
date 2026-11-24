import { Prisma } from '@prisma/client';
import type { Redondeo } from './aumento';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Al múltiplo más cercano del redondeo (mitad hacia arriba), nunca menos que un múltiplo. */
export function redondear(valor: Dec, redondeo: Redondeo): Dec {
  const paso = new D(redondeo);
  const n = new D(valor).div(paso).toDecimalPlaces(0, D.ROUND_HALF_UP);
  return D.max(n, 1).times(paso);
}

/** E52: base × (1 + porcentaje/100), redondeado (desde otra lista: ± %; desde el costo: margen sobre el costo). */
export const precioDerivado = (base: Dec, porcentaje: Dec, redondeo: Redondeo): Dec => redondear(new D(base).times(new D(1).plus(new D(porcentaje).div(100))), redondeo);
