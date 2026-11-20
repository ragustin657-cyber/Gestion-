import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface JurisdiccionEntrada { jurisdiccion: string; coeficiente: string; alicuota: string; retenciones: string; percepciones: string; saldoAnterior: string }
export interface EntradaPosicionIibb { ingresos: string; jurisdicciones: JurisdiccionEntrada[] }
export interface DetalleJurisdiccion {
  jurisdiccion: string; coeficiente: string; alicuota: string; base: string; impuesto: string;
  retenciones: string; percepciones: string; saldoAnterior: string; aPagar: string; saldoAFavor: string;
}
export type TotalesIibb = Pick<DetalleJurisdiccion, 'base' | 'impuesto' | 'retenciones' | 'percepciones' | 'saldoAnterior' | 'aPagar' | 'saldoAFavor'>;
export interface ResultadoPosicionIibb { ingresos: string; detalle: DetalleJurisdiccion[]; totales: TotalesIibb }

const CAMPOS: (keyof TotalesIibb)[] = ['base', 'impuesto', 'retenciones', 'percepciones', 'saldoAnterior', 'aPagar', 'saldoAFavor'];

/**
 * Liquidación mensual de IIBB por Convenio Multilateral (spec E38 §4): por jurisdicción, base = ingresos × coeficiente,
 * impuesto = base × alícuota; se restan retenciones, percepciones y el saldo a favor anterior. Las jurisdicciones no se compensan.
 */
export function calcularPosicionIibb(e: EntradaPosicionIibb): ResultadoPosicionIibb {
  const ingresos = r2(new D(e.ingresos));
  const detalle = e.jurisdicciones.map((j) => {
    const base = r2(ingresos.times(j.coeficiente));
    const impuesto = r2(base.times(j.alicuota).div(100));
    const resultado = impuesto.minus(j.retenciones).minus(j.percepciones).minus(j.saldoAnterior);
    return {
      jurisdiccion: j.jurisdiccion, coeficiente: new D(j.coeficiente).toFixed(6), alicuota: new D(j.alicuota).toFixed(4),
      base: base.toFixed(2), impuesto: impuesto.toFixed(2), retenciones: r2(new D(j.retenciones)).toFixed(2),
      percepciones: r2(new D(j.percepciones)).toFixed(2), saldoAnterior: r2(new D(j.saldoAnterior)).toFixed(2),
      aPagar: r2(D.max(resultado, 0)).toFixed(2), saldoAFavor: r2(D.max(resultado.neg(), 0)).toFixed(2),
    };
  });
  const totales = Object.fromEntries(CAMPOS.map((c) => [c, detalle.reduce((t, d) => t.plus(d[c]), new D(0)).toFixed(2)])) as unknown as TotalesIibb;
  return { ingresos: ingresos.toFixed(2), detalle, totales };
}

export type ConceptoLiquidacionIibb = 'IIBB_IMPUESTO' | 'RETENCION_SUFRIDA_IIBB' | 'PERCEPCION_IIBB' | 'IIBB_SALDO_A_FAVOR' | 'IIBB_A_PAGAR';

/**
 * Renglones del asiento de liquidación (spec E38 §5): gasto por el impuesto, cancela retenciones, percepciones y el saldo a favor
 * anterior, registra el nuevo y lo a pagar. Neto por cuenta: un importe negativo cambia de lado y los ceros se omiten.
 */
export function renglonesAsientoIibb(p: ResultadoPosicionIibb): { concepto: ConceptoLiquidacionIibb; debe: string; haber: string }[] {
  const t = p.totales;
  const lados: [ConceptoLiquidacionIibb, 'debe' | 'haber', string][] = [
    ['IIBB_IMPUESTO', 'debe', t.impuesto], ['RETENCION_SUFRIDA_IIBB', 'haber', t.retenciones], ['PERCEPCION_IIBB', 'haber', t.percepciones],
    ['IIBB_SALDO_A_FAVOR', 'haber', t.saldoAnterior], ['IIBB_SALDO_A_FAVOR', 'debe', t.saldoAFavor], ['IIBB_A_PAGAR', 'haber', t.aPagar],
  ];
  const neto = new Map<ConceptoLiquidacionIibb, Dec>();
  for (const [c, lado, v] of lados) neto.set(c, (neto.get(c) ?? new D(0)).plus(lado === 'debe' ? new D(v) : new D(v).neg()));
  const out: { concepto: ConceptoLiquidacionIibb; debe: string; haber: string }[] = [];
  for (const [concepto, v] of neto) {
    if (v.toDecimalPlaces(2).isZero()) continue;
    out.push({ concepto, debe: v.gt(0) ? v.toFixed(2) : '0.00', haber: v.lt(0) ? v.abs().toFixed(2) : '0.00' });
  }
  return out;
}
