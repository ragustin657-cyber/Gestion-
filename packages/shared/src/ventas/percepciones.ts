import { a2, D } from '../compras/decimal';

/** Percepción de IIBB (spec E39 §4): base × alícuota; 0 sin alícuota, con base no positiva o si en pesos no llega al mínimo. */
export function percepcionIibb(e: { base: string; alicuota: string | null; minimoPesos: string; cotizacion: string }): string {
  const b = new D(e.base);
  if (e.alicuota === null || b.lte(0)) return '0.00';
  const imp = b.mul(e.alicuota).div(100).toDecimalPlaces(2);
  if (imp.lte(0) || imp.mul(e.cotizacion).toDecimalPlaces(2).lt(e.minimoPesos)) return '0.00';
  return a2(imp);
}

const GENERAL = ['21', '27'], REDUCIDA = ['10.5', '5', '2.5'];

/**
 * Percepción de IVA (spec E39 §4): un renglón por tramo, alícuota general para el neto al 21 y 27 %, reducida para el 10,5, 5 y 2,5 %.
 * Sin percepción si el neto gravado en pesos no supera el mínimo. La exclusión parcial reduce el importe en su porcentaje.
 */
export function percepcionesIva(e: {
  netoPorAlicuota: Record<string, string>; alicuotaGeneral: string; alicuotaReducida: string; minimoNetoPesos: string; cotizacion: string; exclusionPct: number | null;
}): { tramo: 'GENERAL' | 'REDUCIDA'; base: string; alicuota: string; importe: string }[] {
  const suma = (claves: string[]) => Object.entries(e.netoPorAlicuota).filter(([k]) => claves.includes(new D(k).toString())).reduce((t, [, v]) => t.plus(v), new D(0));
  const general = suma(GENERAL), reducida = suma(REDUCIDA);
  if (general.plus(reducida).mul(e.cotizacion).toDecimalPlaces(2).lte(e.minimoNetoPesos)) return [];
  const factor = new D(100 - (e.exclusionPct ?? 0)).div(100);
  const out: { tramo: 'GENERAL' | 'REDUCIDA'; base: string; alicuota: string; importe: string }[] = [];
  for (const [tramo, base, alicuota] of [['GENERAL', general, e.alicuotaGeneral], ['REDUCIDA', reducida, e.alicuotaReducida]] as const) {
    const imp = base.mul(alicuota).div(100).mul(factor).toDecimalPlaces(2);
    if (base.gt(0) && imp.gt(0)) out.push({ tramo, base: a2(base), alicuota: new D(alicuota).toString(), importe: a2(imp) });
  }
  return out;
}

/** Reversión en la NC (spec E39 §5): base de la NC × alícuota de la asociada (con su exclusión), sin superar lo percibido aún no revertido. */
export function revertirPercepcion(e: { baseNc: string; alicuota: string; exclusionPct: number | null; percibido: string; yaRevertido: string }): string {
  const calc = new D(e.baseNc).mul(e.alicuota).div(100).mul(new D(100 - (e.exclusionPct ?? 0)).div(100)).toDecimalPlaces(2);
  const resto = new D(e.percibido).minus(e.yaRevertido);
  return a2(D.max(D.min(calc, resto), 0));
}
