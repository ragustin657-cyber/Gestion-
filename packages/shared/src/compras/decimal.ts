import Decimal from 'decimal.js';

/** Instancia de Decimal con redondeo comercial (ROUND_HALF_UP) para montos. */
export const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP, precision: 40 });
export type Dec = InstanceType<typeof D>;

/** Convierte a decimal; devuelve null si no es un número válido. */
export function dec(v: string | number | null | undefined): Dec | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    const d = new D(typeof v === 'string' ? v.trim() : v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export const a2 = (d: Dec) => d.toDecimalPlaces(2).toFixed(2);
export const sinCeros = (d: Dec) => d.toDecimalPlaces(6).toString();
