import { Prisma, TipoCuenta } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Ajuste por inflación impositivo (Título VI de Ganancias, spec E45 §4). Cálculo puro: lo reutiliza la DJ de Ganancias. */
export type TipoMovimiento = 'APORTE' | 'RETIRO' | 'COMPRA_EXCLUIDO' | 'VENTA_EXCLUIDO' | 'MANUAL';
/** importe con signo: positivo = da ajuste positivo (retiro, compra de excluido); negativo = ajuste negativo. */
export interface MovimientoDinamico { fecha: Date; asientoNumero: number | null; descripcion: string; tipo: TipoMovimiento; importe: Dec }
export interface DatosAjusteImpositivo {
  mesAnterior: string; mesCierre: string; activoComputable: Dec; pasivoComputable: Dec; manualActivo: Dec; manualPasivo: Dec;
  movimientos: MovimientoDinamico[]; indice: (mes: string) => Dec;
}
export interface ResultadoAjusteImpositivo {
  base: Dec; coeficienteEstatico: Dec; estatico: Dec;
  dinamico: (MovimientoDinamico & { coeficiente: Dec; ajuste: Dec })[]; totalDinamico: Dec;
  total: Dec; variacion36: Dec; corresponde: boolean; totalDj: Dec; aviso: string | null;
}

const mes = (d: Date) => d.toISOString().slice(0, 7);
const r2 = (x: Dec) => x.toDecimalPlaces(2);
/** Mes 'AAAA-MM' desplazado n meses. */
const mover = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
/** Prueba de la inflación (art. 106): variación del IPC de los 36 meses anteriores al cierre. */
const MESES_PRUEBA = 36;
const UMBRAL = 100;

export function mesesNecesarios(d: Pick<DatosAjusteImpositivo, 'mesAnterior' | 'mesCierre' | 'movimientos'>): string[] {
  return [...new Set([mover(d.mesCierre, -MESES_PRUEBA), d.mesAnterior, d.mesCierre, ...d.movimientos.map((m) => mes(m.fecha))])].sort();
}

/** Efecto de un asiento: variación del patrimonio neto (haber − debe) y de los activos excluidos (debe − haber). */
export function clasificarAsiento(renglones: { tipoCuenta: TipoCuenta; excluida: boolean; debe: Dec; haber: Dec }[]): { pn: Dec; excluidos: Dec } {
  let pn = new D(0), excluidos = new D(0);
  for (const r of renglones) {
    if (r.tipoCuenta === 'PATRIMONIO_NETO') pn = pn.plus(r.haber).minus(r.debe);
    else if (r.tipoCuenta === 'ACTIVO' && r.excluida) excluidos = excluidos.plus(r.debe).minus(r.haber);
  }
  return { pn, excluidos };
}

export function ajusteImpositivo(d: DatosAjusteImpositivo): ResultadoAjusteImpositivo {
  const ic = d.indice(d.mesCierre);
  const coef = (m: string) => ic.div(d.indice(m)).minus(1);
  const base = new D(d.activoComputable).plus(d.manualActivo).minus(d.pasivoComputable).minus(d.manualPasivo);
  const coeficienteEstatico = coef(d.mesAnterior);
  // Activo computable mayor que el pasivo: ajuste negativo (pérdida); menor: positivo
  const estatico = r2(base.times(coeficienteEstatico).negated());
  const dinamico = d.movimientos.map((m) => { const c = coef(mes(m.fecha)); return { ...m, coeficiente: c, ajuste: r2(new D(m.importe).times(c)) }; });
  const totalDinamico = dinamico.reduce((s, m) => s.plus(m.ajuste), new D(0));
  const total = estatico.plus(totalDinamico);
  const variacion36 = r2(coef(mover(d.mesCierre, -MESES_PRUEBA)).times(100));
  const corresponde = variacion36.gt(UMBRAL);
  const aviso = corresponde ? null : `No corresponde aplicar el ajuste: la variación de los últimos ${MESES_PRUEBA} meses es ${variacion36.toFixed(2).replace('.', ',')} %`;
  return { base, coeficienteEstatico, estatico, dinamico, totalDinamico, total, variacion36, corresponde, totalDj: corresponde ? total : new D(0), aviso };
}
