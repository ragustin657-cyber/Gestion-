import { a2, D, Dec } from './decimal';

export interface LineaMoneda {
  clave: string;
  lado: 'DEBE' | 'HABER';
  importe: string;
}

/**
 * Convierte líneas de asiento a pesos. Cada lado totaliza round(Σ original × cotización);
 * la diferencia de redondeo de las líneas se ajusta en la línea de mayor importe de ese lado.
 */
export function lineasEnPesos(lineas: LineaMoneda[], cotizacion: string): LineaMoneda[] {
  const cot = new D(cotizacion);
  const r = lineas.map((l) => ({ ...l, importe: a2(new D(l.importe).mul(cot)) }));
  const suma = (xs: { importe: string }[]) => xs.reduce((s: Dec, x) => s.plus(x.importe), new D(0));
  const original = { DEBE: suma(lineas.filter((l) => l.lado === 'DEBE')), HABER: suma(lineas.filter((l) => l.lado === 'HABER')) };
  if (!original.DEBE.eq(original.HABER)) throw new Error('Las líneas en moneda original no balancean');
  const objetivo = new D(a2(original.DEBE.mul(cot)));
  for (const lado of ['DEBE', 'HABER'] as const) {
    const delLado = r.filter((l) => l.lado === lado);
    const dif = objetivo.minus(suma(delLado));
    if (!dif.isZero() && delLado.length) {
      const mayor = delLado.reduce((m, l) => (new D(l.importe).abs().gt(new D(m.importe).abs()) ? l : m));
      mayor.importe = a2(new D(mayor.importe).plus(dif));
    }
  }
  return r;
}
