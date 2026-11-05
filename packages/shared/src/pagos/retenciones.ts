import { a2, D, Dec } from '../compras/decimal';

export interface RegimenCalculo {
  minimoNoSujeto: string;
  alicuotaInscripto: string;
  alicuotaNoInscripto: string;
  usaEscala: boolean;
  minimoRetencion: string;
}
export interface TramoCalculo { desde: string; hasta: string | null; fijo: string; porcentaje: string }

/** Base sujeta a retención: proporción sin IVA ni percepciones del importe cancelado. Anticipos (sin comprobante): el importe. */
export function baseSujeta(
  importePesos: string,
  c: { netoGravado: string; noGravado: string; exento: string; total: string } | null,
): string {
  const imp = new D(importePesos);
  if (!c || new D(c.total).isZero()) return a2(imp);
  const sinIva = new D(c.netoGravado).plus(c.noGravado).plus(c.exento);
  return a2(imp.mul(sinIva).div(c.total));
}

function impuestoEscala(monto: Dec, escala: TramoCalculo[]): Dec {
  const tramo = [...escala]
    .sort((a, b) => new D(a.desde).cmp(b.desde))
    .find((t) => monto.gte(t.desde) && (t.hasta === null || monto.lt(t.hasta)));
  if (!tramo) return new D(0);
  return new D(tramo.fijo).plus(monto.minus(tramo.desde).mul(tramo.porcentaje).div(100));
}

/** Retención de Ganancias (RG 830) sobre el acumulado mensual del proveedor por régimen. */
export function retencionGanancias(e: {
  sujeto: boolean;
  inscripto: boolean;
  regimen: RegimenCalculo;
  escala: TramoCalculo[];
  baseAcumuladaPrevia: string;
  basePago: string;
  retenidoPrevio: string;
}): { importe: string; acumulado: string; sujetoRetencion: string; impuestoDeterminado: string } {
  const pago = new D(e.basePago);
  const acumulado = new D(e.baseAcumuladaPrevia).plus(pago);
  const cero = { importe: '0.00', acumulado: a2(acumulado), sujetoRetencion: '0.00', impuestoDeterminado: '0.00' };
  if (!e.sujeto || pago.lte(0)) return cero;
  const sujeto = D.max(0, acumulado.minus(e.regimen.minimoNoSujeto));
  const impuesto = e.regimen.usaEscala && e.inscripto
    ? impuestoEscala(sujeto, e.escala)
    : sujeto.mul(e.inscripto ? e.regimen.alicuotaInscripto : e.regimen.alicuotaNoInscripto).div(100);
  const impuestoR = impuesto.toDecimalPlaces(2);
  let retencion = D.max(0, impuestoR.minus(e.retenidoPrevio));
  if (retencion.lt(e.regimen.minimoRetencion)) retencion = new D(0);
  return { importe: a2(retencion), acumulado: a2(acumulado), sujetoRetencion: a2(sujeto), impuestoDeterminado: a2(impuestoR) };
}

/** Alícuota de IIBB a aplicar: padrón → ficha → por defecto (según configuración) → null (no retener). */
export function alicuotaIibb(e: {
  exento: boolean;
  padron: string | null;
  ficha: string | null;
  usaPadron: boolean;
  sinPadron: 'NO_RETENER' | 'ALICUOTA_DEFECTO';
  alicuotaDefecto: string;
}): string | null {
  if (e.exento) return null;
  if (e.usaPadron && e.padron !== null) return e.padron;
  if (e.ficha !== null) return e.ficha;
  if (e.sinPadron === 'ALICUOTA_DEFECTO') return e.alicuotaDefecto;
  return null;
}

/** Retención de IIBB: base × alícuota, 0 si la base es ≤ 0 o el resultado no llega al mínimo. */
export function retencionIibb(base: string, alicuota: string, minimo: string): string {
  const b = new D(base);
  if (b.lte(0)) return '0.00';
  const r = b.mul(alicuota).div(100).toDecimalPlaces(2);
  return r.lt(minimo) ? '0.00' : a2(r);
}
