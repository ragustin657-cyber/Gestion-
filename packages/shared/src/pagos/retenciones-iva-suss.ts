import { D, Dec } from '../compras/decimal';

const a2 = (x: Dec) => x.toDecimalPlaces(2).toFixed(2);
const CERO = { importe: '0.00' };

/**
 * Retención de IVA de una factura (E35): base = IVA de la factura × lo pagado / total; retención = base × porcentaje,
 * a la mitad con exclusión del 50 % y nada con la del 100 %. No retiene si el total no llega al mínimo del comprobante
 * o si la retención no llega al mínimo de retención. Importes en pesos.
 */
export function retencionIva(e: {
  ivaFactura: string; totalFactura: string; imputado: string; porcentaje: string; minimoComprobante: string; minimoRetencion: string; exclusion: 0 | 50 | 100;
}): { base: string; importe: string } {
  const iva = new D(e.ivaFactura), total = new D(e.totalFactura), pagado = new D(e.imputado);
  if (iva.lte(0) || total.lte(0) || pagado.lte(0)) return { base: '0.00', ...CERO };
  const base = new D(a2(iva.mul(pagado).div(total)));
  if (total.lt(e.minimoComprobante) || e.exclusion === 100) return { base: a2(base), ...CERO };
  let importe = base.mul(e.porcentaje).div(100);
  if (e.exclusion === 50) importe = importe.div(2);
  const r = new D(a2(importe));
  return { base: a2(base), importe: r.lt(e.minimoRetencion) ? '0.00' : a2(r) };
}

/** Retención de SUSS de una factura (E35): base = parte sin IVA de lo pagado; no retiene bajo el mínimo no sujeto ni bajo el mínimo de retención. */
export function retencionSuss(e: { base: string; porcentaje: string; minimoNoSujeto: string; minimoRetencion: string }): { importe: string } {
  const base = new D(e.base);
  if (base.lte(0) || base.lt(e.minimoNoSujeto)) return CERO;
  const r = new D(a2(base.mul(e.porcentaje).div(100)));
  return { importe: r.lt(e.minimoRetencion) ? '0.00' : a2(r) };
}

/**
 * Notas de crédito imputadas en la misma OP (E35): cada una reduce primero lo pagado de su factura asociada si está en la OP;
 * lo que sobra (o una nota sin asociada) se reparte en proporción a lo que queda de cada factura. Nunca queda negativo.
 * `imputado` de las notas en valor absoluto.
 */
export function netearNotasCredito(facturas: { id: string; imputado: string }[], notas: { asociadaId: string | null; imputado: string }[]): { id: string; imputado: string }[] {
  const res = new Map(facturas.map((f) => [f.id, new D(f.imputado)]));
  let resto = new D(0);
  for (const n of notas) {
    let monto = new D(n.imputado).abs();
    const actual = n.asociadaId ? res.get(n.asociadaId) : undefined;
    if (actual !== undefined && n.asociadaId) {
      const usado = D.min(actual, monto);
      res.set(n.asociadaId, actual.minus(usado));
      monto = monto.minus(usado);
    }
    resto = resto.plus(monto);
  }
  const totalQueda = [...res.values()].reduce((s, x) => s.plus(x), new D(0));
  if (resto.gt(0) && totalQueda.gt(0)) {
    const factor = D.max(totalQueda.minus(resto), 0).div(totalQueda);
    for (const [k, v] of res) res.set(k, v.mul(factor));
  }
  return facturas.map((f) => ({ id: f.id, imputado: a2(D.max(res.get(f.id)!, 0)) }));
}
