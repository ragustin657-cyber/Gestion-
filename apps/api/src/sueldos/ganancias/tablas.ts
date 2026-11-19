import { Prisma } from '@prisma/client';
import type { TablaCalc } from './calculo';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** La tabla del semestre falta: es un error del empleado en el borrador (no deja cerrar). */
export class SinTablaGanancias extends Error {}

export const nombreSemestre = (s: 1 | 2, anio?: number) => `${s === 1 ? '1.er' : '2.º'} semestre${anio ? ` ${anio}` : ''}`;
const IMPORTES = ['gni', 'deduccionEspecial', 'conyuge', 'hijo', 'hijoIncapacitado', 'topeHipotecario', 'topeSeguroMuerte', 'topeSeguroMixto', 'topeSeguroRetiro', 'topeSepelio'] as const;

/**
 * Tabla acumulada al mes (spec E32 §3, Tabla 5 del manual F.1359): cada mes k suma 1/12 del valor anual del semestre de k.
 * Sin la tabla del 1.er semestre, en julio a diciembre usa la del 2.º para enero a junio (con aviso).
 */
export function tablaAcumulada(t1: TablaCalc | null, t2: TablaCalc | null, mes: number, anio?: number): { tabla: TablaCalc; avisos: string[] } {
  const avisos: string[] = [];
  const propia = mes <= 6 ? t1 : t2;
  if (!propia) throw new SinTablaGanancias(`Cargue la tabla de Ganancias de ${nombreSemestre(mes <= 6 ? 1 : 2, anio)}`);
  let primera = t1;
  if (mes > 6 && !t1) { primera = t2; avisos.push('Falta la tabla de Ganancias del 1.er semestre: se usa la del 2.º para enero a junio'); }
  const m1 = Math.min(mes, 6);
  const m2 = Math.max(mes - 6, 0);
  const acum = (a: Dec | number | null | undefined, b: Dec | number | null | undefined) => r2(new D(a ?? 0).times(m1).div(12).plus(new D(b ?? 0).times(m2).div(12)));
  const tabla = {} as TablaCalc;
  for (const k of IMPORTES) tabla[k] = acum(primera![k], t2?.[k]);
  // Escala: tramo a tramo; si las escalas no se pueden emparejar, la del semestre del mes
  const a = primera!.tramos;
  const b = t2?.tramos ?? a;
  if (m2 > 0 && a.length !== b.length) {
    avisos.push('Las escalas de los dos semestres tienen distinta cantidad de tramos: se usa la del semestre del mes');
    tabla.tramos = propia.tramos.map((x) => ({ desde: r2(x.desde.times(mes).div(12)), hasta: x.hasta ? r2(x.hasta.times(mes).div(12)) : null, fijo: r2(x.fijo.times(mes).div(12)), porcentaje: x.porcentaje }));
  } else {
    const ref = mes <= 6 ? a : b;
    tabla.tramos = ref.map((x, i) => ({
      desde: acum(a[i].desde, m2 ? b[i].desde : 0), hasta: x.hasta === null ? null : acum(a[i].hasta, m2 ? b[i].hasta : 0),
      fijo: acum(a[i].fijo, m2 ? b[i].fijo : 0), porcentaje: x.porcentaje,
    }));
  }
  return { tabla, avisos };
}

/** Liquidación anual: valores anuales del 2.º semestre, sin prorratear (Tabla 5 Anual del manual). */
export function tablaAnual(t2: TablaCalc): TablaCalc {
  return { ...t2, tramos: t2.tramos.map((x) => ({ ...x })) };
}

/** Liquidación final: valores anuales completos del semestre de la fecha de pago (manual §2.2 y Tabla 6). */
export function tablaFinal(t1: TablaCalc | null, t2: TablaCalc | null, mesDePago: number, anio?: number): TablaCalc {
  const t = mesDePago <= 6 ? t1 : t2;
  if (!t) throw new SinTablaGanancias(`Cargue la tabla de Ganancias de ${nombreSemestre(mesDePago <= 6 ? 1 : 2, anio)}`);
  return tablaAnual(t);
}

/** Importe acumulado de una carga de familia: 1/12 del valor anual del semestre de cada mes de vigencia hasta el mes. */
export function cargaAcumulada(anualPorSemestre: [Dec, Dec], mesDesde: number, mesHasta: number, mes: number, porcentaje: number): Dec {
  let s = new D(0);
  for (let k = Math.max(mesDesde, 1); k <= Math.min(mesHasta, mes); k++) s = s.plus(anualPorSemestre[k <= 6 ? 0 : 1].div(12));
  return r2(s.times(porcentaje).div(100));
}
