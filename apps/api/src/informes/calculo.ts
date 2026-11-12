import { Prisma } from '@prisma/client';
import { unAnioAntes } from '../contabilidad/estados/fechas';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const DIA = 86400000;

export type Tramo = 'aVencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'mas90';
export const TRAMOS: Tramo[] = ['aVencer', 'd1_30', 'd31_60', 'd61_90', 'mas90'];

/** Tramo de antigüedad por días vencidos al corte (a vencer: aún no venció). */
export function tramoDe(corte: Date, vencimiento: Date): Tramo {
  const dias = Math.round((corte.getTime() - vencimiento.getTime()) / DIA);
  return dias <= 0 ? 'aVencer' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'mas90';
}

const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Coeficiente de cada mes a moneda del último mes con índice que no supere `mesHasta` (spec §3). */
export function coeficientes(meses: string[], indices: Map<string, Dec>, mesHasta: string): { coef: Map<string, Dec>; base: string } | { faltan: string[] } {
  const base = [...indices.keys()].filter((m) => m <= mesHasta).sort().pop();
  const faltan = [...new Set(meses.filter((m) => !indices.has(m)))].sort();
  if (!base || faltan.length) return { faltan: (faltan.length ? faltan : [mesHasta]).map(mmaaaa) };
  const ib = indices.get(base)!;
  return { coef: new Map([...new Set(meses)].map((m) => [m, ib.div(indices.get(m)!)])), base };
}

/** Rotación = costo vendido / stock promedio; días de cobertura = stock final / costo diario. */
export function rotacion(costoVendido: Dec, stockInicial: Dec, stockFinal: Dec, dias: number): { rotacion: string | null; diasCobertura: string | null } {
  const promedio = new D(stockInicial).plus(stockFinal).div(2);
  return {
    rotacion: promedio.isZero() ? null : new D(costoVendido).div(promedio).toFixed(2),
    diasCobertura: new D(costoVendido).isZero() || dias <= 0 ? null : new D(stockFinal).div(new D(costoVendido).div(dias)).toFixed(1),
  };
}

export function variacion(valor: Dec, anterior: Dec): { importe: string; pct: string | null } {
  return { importe: new D(valor).minus(anterior).toFixed(2), pct: new D(anterior).isZero() ? null : new D(valor).minus(anterior).div(new D(anterior).abs()).times(100).toFixed(2) };
}

/** Período de igual cantidad de días inmediatamente anterior. */
export function periodoAnterior(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  const dias = Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1;
  const nuevoHasta = new Date(desde.getTime() - DIA);
  return { desde: new Date(nuevoHasta.getTime() - (dias - 1) * DIA), hasta: nuevoHasta };
}

export function anioAnterior(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  return { desde: unAnioAntes(desde), hasta: unAnioAntes(hasta) };
}
