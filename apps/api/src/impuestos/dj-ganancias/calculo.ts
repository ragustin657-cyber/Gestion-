import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** DJ anual de Ganancias de sociedades (spec E46 §3). Cálculo puro. */
export interface TramoEscala { desde: Dec; fijo: Dec; alicuota: Dec }
export interface DatosDj {
  resultadoContable: Dec; diferenciaAmortizaciones: Dec; ajusteInflacion: Dec;
  ajustesManuales: { concepto: string; importe: Dec }[]; quebrantosAnteriores: Dec; tramos: TramoEscala[];
  retenciones: Dec; percepciones: Dec; impuestoCheque: Dec; anticiposIngresados: Dec; saldoAFavorAnterior: Dec; otrosPagos: Dec;
  mesCierre: string; mesesEjercicio: number;
}
export interface Anticipo { numero: number; mes: string; porcentaje: Dec; importe: Dec }
export interface ResultadoDj {
  resultadoContable: Dec; ajusteAmortizaciones: Dec; ajusteInflacion: Dec; totalAjustesManuales: Dec; resultadoImpositivo: Dec;
  quebrantosComputados: Dec; quebrantoEjercicio: Dec; gananciaNetaImponible: Dec; impuestoDeterminado: Dec;
  pagosACuenta: Dec; saldo: Dec; baseAnticipos: Dec; vencimientoDj: string; anticipos: Anticipo[]; avisos: string[];
}

const r2 = (x: Dec) => x.toDecimalPlaces(2);
const suma = (xs: Dec[]) => xs.reduce((s, x) => s.plus(x), new D(0));
const mover = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
/** Anticipos de sociedades (RG 5211, a verificar): 10, el primero del 25 % y los demás del 8,33 %. */
const PRIMER_ANTICIPO = new D(25);
const ANTICIPO = new D('8.33');
const CANTIDAD_ANTICIPOS = 10;
/** La DJ vence en el 5.º mes siguiente al cierre y los anticipos empiezan el 6.º. */
const MESES_VENCIMIENTO = 5;

/** Impuesto de la escala (art. 73): fijo del tramo más la alícuota sobre el excedente de su «desde». */
export function impuestoEscala(gni: Dec, tramos: TramoEscala[]): Dec {
  if (new D(gni).lte(0)) return new D(0);
  const t = [...tramos].sort((a, b) => new D(a.desde).cmp(b.desde)).filter((x) => new D(x.desde).lte(gni)).at(-1);
  if (!t) return new D(0);
  return r2(new D(t.fijo).plus(new D(gni).minus(t.desde).times(t.alicuota).div(100)));
}

export function determinarDj(d: DatosDj): ResultadoDj {
  const ajusteAmortizaciones = new D(d.diferenciaAmortizaciones).negated();
  const totalAjustesManuales = suma(d.ajustesManuales.map((a) => new D(a.importe)));
  const resultadoImpositivo = r2(new D(d.resultadoContable).plus(ajusteAmortizaciones).plus(d.ajusteInflacion).plus(totalAjustesManuales));
  const positivo = resultadoImpositivo.gt(0) ? resultadoImpositivo : new D(0);
  const quebrantosComputados = D.min(new D(d.quebrantosAnteriores), positivo);
  const quebrantoEjercicio = resultadoImpositivo.lt(0) ? resultadoImpositivo.negated() : new D(0);
  const gananciaNetaImponible = positivo.minus(quebrantosComputados);
  const impuestoDeterminado = impuestoEscala(gananciaNetaImponible, d.tramos);
  const pagosACuenta = suma([d.retenciones, d.percepciones, d.impuestoCheque, d.anticiposIngresados, d.saldoAFavorAnterior, d.otrosPagos].map((x) => new D(x)));
  const saldo = impuestoDeterminado.minus(pagosACuenta);
  const base = impuestoDeterminado.minus(d.retenciones).minus(d.percepciones).minus(d.impuestoCheque);
  const baseAnticipos = base.gt(0) ? base : new D(0);
  const anticipos: Anticipo[] = [];
  let acumulado = new D(0);
  for (let i = 1; i <= CANTIDAD_ANTICIPOS; i++) {
    const porcentaje = i === 1 ? PRIMER_ANTICIPO : ANTICIPO;
    // El último ajusta el redondeo para que sumen la base
    const importe = i === CANTIDAD_ANTICIPOS ? baseAnticipos.minus(acumulado) : r2(baseAnticipos.times(porcentaje).div(100));
    acumulado = acumulado.plus(importe);
    anticipos.push({ numero: i, mes: mover(d.mesCierre, MESES_VENCIMIENTO + i), porcentaje, importe });
  }
  const avisos = d.mesesEjercicio !== 12 ? ['El ejercicio no es de 12 meses: verifique la escala aplicada'] : [];
  return {
    resultadoContable: new D(d.resultadoContable), ajusteAmortizaciones, ajusteInflacion: new D(d.ajusteInflacion), totalAjustesManuales, resultadoImpositivo,
    quebrantosComputados, quebrantoEjercicio, gananciaNetaImponible, impuestoDeterminado, pagosACuenta, saldo, baseAnticipos,
    vencimientoDj: mover(d.mesCierre, MESES_VENCIMIENTO), anticipos, avisos,
  };
}
