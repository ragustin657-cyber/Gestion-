import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const f2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const suma = (r: Record<string, string>) => Object.values(r).reduce((t, x) => t.plus(x), new D(0));

export interface EntradaPosicionIva {
  /** IVA por alícuota del Libro IVA Ventas (débito) y Compras (crédito) del mes, en pesos */
  debito: Record<string, string>; credito: Record<string, string>;
  retenciones: string; percepciones: string; saldoTecnicoAnterior: string; libreAnterior: string;
}
export interface ResultadoPosicionIva {
  totalDebito: string; totalCredito: string; saldoTecnicoAFavor: string; impuestoDeterminado: string; impuestoAPagar: string; libreDisponibilidad: string;
}

/**
 * Posición mensual de IVA como el F.2002 (spec E37 §4): saldo técnico = débito − crédito − saldo técnico anterior; si es positivo
 * es el impuesto determinado y se le restan retenciones, percepciones y el saldo de libre disponibilidad anterior.
 */
export function calcularPosicionIva(e: EntradaPosicionIva): ResultadoPosicionIva {
  const debito = suma(e.debito), credito = suma(e.credito);
  const tecnico = debito.minus(credito).minus(e.saldoTecnicoAnterior);
  const determinado = D.max(tecnico, 0);
  const saldo = determinado.minus(e.retenciones).minus(e.percepciones).minus(e.libreAnterior);
  return {
    totalDebito: f2(debito), totalCredito: f2(credito), saldoTecnicoAFavor: f2(D.max(tecnico.neg(), 0)), impuestoDeterminado: f2(determinado),
    impuestoAPagar: f2(D.max(saldo, 0)), libreDisponibilidad: f2(D.max(saldo.neg(), 0)),
  };
}

export type ConceptoLiquidacionIva = 'IVA_DEBITO_FISCAL' | 'IVA_CREDITO_FISCAL' | 'PERCEPCION_IVA' | 'RETENCION_SUFRIDA_IVA' | 'IVA_SALDO_TECNICO' | 'IVA_LIBRE_DISPONIBILIDAD' | 'IVA_A_PAGAR';

/**
 * Renglones del asiento de liquidación (spec E37 §6): cancela débito, crédito, percepciones, retenciones y los saldos anteriores,
 * y registra los saldos nuevos y el impuesto a pagar. Un importe negativo cambia de lado; los ceros se omiten. Cuadra por construcción.
 */
export function renglonesAsiento(p: EntradaPosicionIva & ResultadoPosicionIva): { concepto: ConceptoLiquidacionIva; debe: string; haber: string }[] {
  const lados: [ConceptoLiquidacionIva, 'debe' | 'haber', Prisma.Decimal.Value][] = [
    ['IVA_DEBITO_FISCAL', 'debe', p.totalDebito], ['IVA_CREDITO_FISCAL', 'haber', p.totalCredito], ['PERCEPCION_IVA', 'haber', p.percepciones],
    ['RETENCION_SUFRIDA_IVA', 'haber', p.retenciones], ['IVA_SALDO_TECNICO', 'haber', p.saldoTecnicoAnterior], ['IVA_LIBRE_DISPONIBILIDAD', 'haber', p.libreAnterior],
    ['IVA_SALDO_TECNICO', 'debe', p.saldoTecnicoAFavor], ['IVA_LIBRE_DISPONIBILIDAD', 'debe', p.libreDisponibilidad], ['IVA_A_PAGAR', 'haber', p.impuestoAPagar],
  ];
  // Neto por cuenta (debe − haber): el saldo técnico anterior que se cancela y el nuevo que se registra van a la misma cuenta
  const neto = new Map<ConceptoLiquidacionIva, Prisma.Decimal>();
  for (const [concepto, lado, valor] of lados) neto.set(concepto, (neto.get(concepto) ?? new D(0)).plus(lado === 'debe' ? new D(valor) : new D(valor).neg()));
  const out: { concepto: ConceptoLiquidacionIva; debe: string; haber: string }[] = [];
  for (const [concepto, v] of neto) {
    if (v.toDecimalPlaces(2).isZero()) continue;
    out.push({ concepto, debe: v.gt(0) ? f2(v) : '0.00', haber: v.lt(0) ? f2(v.abs()) : '0.00' });
  }
  return out;
}
