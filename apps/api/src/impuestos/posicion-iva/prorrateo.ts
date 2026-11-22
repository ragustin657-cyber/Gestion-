import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
const f2 = (x: Prisma.Decimal) => x.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

/** Coeficiente de prorrateo (spec E40 §4): gravadas / (gravadas + exentas y no gravadas), 4 decimales, acotado a [0, 1]. Sin ventas → 1. */
export function coeficienteProrrateo(gravadas: string, exentas: string): { coeficiente: string; sinVentas: boolean; acotado: 0 | 1 | null } {
  const g = new D(gravadas), total = g.plus(exentas);
  if (total.lte(0)) {
    const sinVentas = g.isZero() && new D(exentas).isZero();
    return { coeficiente: '1.0000', sinVentas, acotado: sinVentas ? null : 1 };
  }
  const r = g.div(total);
  const c = D.min(D.max(r, 0), 1);
  // Pulido E42: con ventas negativas el cociente sale de [0, 1] y se acota (la posición lo avisa)
  return { coeficiente: c.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4), sinVentas: false, acotado: r.lt(0) ? 0 : r.gt(1) ? 1 : null };
}

/** Crédito del mes por destino (spec E40 §5): computable = gravado + común × coeficiente + ajuste; el no computable es el resto del total. */
export function separarCredito(e: { gravado: string; exento: string; comun: string; coeficiente: string; ajuste?: string }): { computable: string; noComputable: string } {
  const total = new D(e.gravado).plus(e.exento).plus(e.comun);
  const computable = new D(e.gravado).plus(new D(e.comun).mul(e.coeficiente).toDecimalPlaces(2, D.ROUND_HALF_UP)).plus(e.ajuste ?? 0);
  return { computable: f2(computable), noComputable: f2(total.minus(computable)) };
}

/** Ajuste anual (spec E40 §5): el común de los meses con prorrateo al coeficiente anual, menos lo computado de ese común en cada mes. */
export function ajusteAnual(e: { comunPorMes: { comun: string; computado: string }[]; coeficienteAnual: string }): string {
  const comun = e.comunPorMes.reduce((t, m) => t.plus(m.comun), new D(0));
  const computado = e.comunPorMes.reduce((t, m) => t.plus(m.computado), new D(0));
  return f2(comun.mul(e.coeficienteAnual).toDecimalPlaces(2, D.ROUND_HALF_UP).minus(computado));
}

/** Meses del ejercicio fiscal (que empieza en `inicioMes`) desde su primer mes hasta el mes dado inclusive. */
export function mesesDelEjercicio(anio: number, mes: number, inicioMes: number): { anio: number; mes: number }[] {
  const inicioAnio = mes >= inicioMes ? anio : anio - 1;
  const out: { anio: number; mes: number }[] = [];
  for (let a = inicioAnio, m = inicioMes; a * 12 + m <= anio * 12 + mes; m === 12 ? (a++, (m = 1)) : m++) out.push({ anio: a, mes: m });
  return out;
}

/** ¿Es el último mes del ejercicio fiscal? */
export const ultimoMesEjercicio = (mes: number, inicioMes: number) => mes === (inicioMes === 1 ? 12 : inicioMes - 1);
