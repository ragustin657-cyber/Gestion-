import { a2, D, dec, Dec, sinCeros } from './decimal';

type Num = string | number;

/** Importe de un renglón: cantidad × precio × (1 − bonificación/100), redondeado a 2 decimales. */
export function importeRenglon(r: { cantidad: Num; precioUnitario: Num; bonificacionPct?: Num | null }): string {
  const cantidad = dec(r.cantidad);
  const precio = dec(r.precioUnitario);
  const bonif = r.bonificacionPct === undefined || r.bonificacionPct === null || r.bonificacionPct === '' ? new D(0) : dec(r.bonificacionPct);
  if (!cantidad || cantidad.lte(0)) throw new Error('Cantidad inválida');
  if (!precio || precio.lt(0)) throw new Error('Precio inválido');
  if (!bonif || bonif.lt(0) || bonif.gt(100)) throw new Error('Bonificación inválida');
  return a2(cantidad.mul(precio).mul(new D(1).minus(bonif.div(100))));
}

export interface EntradaTotales {
  discriminaIva: boolean;
  renglones: { importe: string; alicuotaIva: Num }[];
  percepcionIva?: string | null;
  percepcionesIibb?: string[];
  impuestosInternos?: string | null;
  noGravado?: string | null;
  exento?: string | null;
}

export interface Totales {
  netoGravado: string;
  iva: string;
  ivaPorAlicuota: { alicuota: string; base: string; importe: string }[];
  percepciones: string;
  total: string;
}

const val = (v: string | null | undefined): Dec => dec(v ?? 0) ?? new D(0);

/** Totales de un comprobante. El IVA se redondea por alícuota. Sin discriminación de IVA, el IVA es 0. */
export function calcularTotales(e: EntradaTotales): Totales {
  const bases = new Map<string, Dec>();
  let neto = new D(0);
  for (const r of e.renglones) {
    const imp = val(r.importe);
    neto = neto.plus(imp);
    const k = sinCeros(new D(r.alicuotaIva));
    bases.set(k, (bases.get(k) ?? new D(0)).plus(imp));
  }
  const ivaPorAlicuota = e.discriminaIva
    ? [...bases.entries()]
        .sort(([a], [b]) => new D(a).cmp(new D(b)))
        .map(([alicuota, base]) => ({ alicuota, base: a2(base), importe: a2(base.mul(alicuota).div(100)) }))
    : [];
  const iva = ivaPorAlicuota.reduce((s, x) => s.plus(x.importe), new D(0));
  const percepciones = (e.percepcionesIibb ?? []).reduce((s, x) => s.plus(val(x)), val(e.percepcionIva));
  const total = neto.plus(iva).plus(percepciones).plus(val(e.impuestosInternos)).plus(val(e.noGravado)).plus(val(e.exento));
  return { netoGravado: a2(neto), iva: a2(iva), ivaPorAlicuota, percepciones: a2(percepciones), total: a2(total) };
}
