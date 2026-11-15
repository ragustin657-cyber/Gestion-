import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const DIA = 86400000;

export type ClaseConcepto = 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO';
export type TipoConcepto = 'BASICO' | 'ANTIGUEDAD' | 'PORCENTAJE' | 'HORAS_EXTRA' | 'AUSENCIA' | 'FIJO' | 'DESCUENTO_LEY';
export interface ConceptoCalc { id: string; codigo: string; nombre: string; clase: ClaseConcepto; tipo: TipoConcepto; parametros: Record<string, unknown>; orden: number; soloAfiliados: boolean }
export interface EmpleadoCalc { fechaIngreso: Date; fechaEgreso: Date | null; afiliadoSindicato: boolean; basicoMensual: Dec; horasMensuales: number }
export interface NovedadCalc { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string | null; cantidad?: Dec | null; importe?: Dec | null }
export interface RenglonCalc { conceptoId: string; codigo: string; nombre: string; clase: ClaseConcepto; cantidad: Dec | null; base: Dec | null; porcentaje: Dec | null; importe: Dec; orden: number }
export interface ResultadoCalc { renglones: RenglonCalc[]; totalRemunerativo: Dec; totalNoRemunerativo: Dec; totalDescuentos: Dec; neto: Dec; diasTrabajados: number; antiguedadAnios: number }

const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0));

/** Años completos de antigüedad al fin del período. */
export function antiguedadAnios(ingreso: Date, finPeriodo: Date): number {
  let a = finPeriodo.getUTCFullYear() - ingreso.getUTCFullYear();
  const aniversario = new Date(Date.UTC(finPeriodo.getUTCFullYear(), ingreso.getUTCMonth(), ingreso.getUTCDate()));
  if (aniversario > finPeriodo) a--;
  return Math.max(0, a);
}

/** Días trabajados en el mes con mes completo = 30 (spec §5). */
export function diasTrabajados(ingreso: Date, egreso: Date | null, anio: number, mes: number): number {
  const ini = new Date(Date.UTC(anio, mes - 1, 1)), fin = finDeMes(anio, mes);
  const desde = ingreso > ini ? ingreso : ini, hasta = egreso && egreso < fin ? egreso : fin;
  if (hasta < desde) return 0;
  if (desde.getTime() === ini.getTime() && hasta.getTime() === fin.getTime()) return 30;
  return Math.min(30, Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1);
}

const num = (p: Record<string, unknown>, k: string) => new D(Number(p[k] ?? 0));

/** Liquida un empleado en un mes (spec §4, §11). */
export function liquidarMes(e: EmpleadoCalc, conceptos: ConceptoCalc[], novedades: NovedadCalc[], anio: number, mes: number): ResultadoCalc {
  const dias = diasTrabajados(e.fechaIngreso, e.fechaEgreso, anio, mes);
  const anios = antiguedadAnios(e.fechaIngreso, finDeMes(anio, mes));
  const cant = (t: NovedadCalc['tipo']) => novedades.filter((n) => n.tipo === t).reduce((s, n) => s.plus(n.cantidad ?? 0), new D(0));
  const ausencias = cant('AUSENCIA_INJUSTIFICADA');
  const basicoProp = r2(new D(e.basicoMensual).times(dias).div(30));
  const antigProp = (c: ConceptoCalc) => r2(basicoProp.times(num(c.parametros, 'pctPorAnio')).div(100).times(anios));
  const pctAntig = conceptos.find((c) => c.tipo === 'ANTIGUEDAD');
  const antigCompleta = pctAntig ? new D(e.basicoMensual).times(num(pctAntig.parametros, 'pctPorAnio')).div(100).times(anios) : new D(0);
  const antiguedadProp = pctAntig ? antigProp(pctAntig) : new D(0);
  const valorDia = new D(e.basicoMensual).plus(antigCompleta).div(30);
  const valorHora = new D(e.basicoMensual).plus(antigCompleta).div(e.horasMensuales);

  const renglones: RenglonCalc[] = [];
  let remu = new D(0), noRemu = new D(0);
  const agregar = (c: ConceptoCalc, importe: Dec, extra: Partial<RenglonCalc> = {}) => {
    const imp = r2(importe);
    if (imp.isZero()) return;
    renglones.push({ conceptoId: c.id, codigo: c.codigo, nombre: c.nombre, clase: c.clase, cantidad: null, base: null, porcentaje: null, importe: imp, orden: c.orden, ...extra });
    if (c.clase === 'REMUNERATIVO') remu = remu.plus(imp);
    else if (c.clase === 'NO_REMUNERATIVO') noRemu = noRemu.plus(imp);
  };
  const aplica = (c: ConceptoCalc) => !c.soloAfiliados || e.afiliadoSindicato;
  const ordenados = [...conceptos].sort((a, b) => a.orden - b.orden);
  const calcular = (c: ConceptoCalc) => {
    const p = c.parametros;
    switch (c.tipo) {
      case 'BASICO': return agregar(c, basicoProp, { cantidad: new D(dias) });
      case 'ANTIGUEDAD': return agregar(c, antigProp(c), { cantidad: new D(anios), porcentaje: num(p, 'pctPorAnio') });
      case 'PORCENTAJE': {
        if (p.pierdeConAusencia && ausencias.gt(0)) return;
        const base = p.base === 'BASICO_MAS_ANTIGUEDAD' ? basicoProp.plus(antiguedadProp) : p.base === 'BRUTO' ? remu.plus(noRemu) : remu;
        return agregar(c, base.times(num(p, 'pct')).div(100), { base, porcentaje: num(p, 'pct') });
      }
      case 'HORAS_EXTRA': {
        const recargo = num(p, 'recargoPct');
        const horas = cant(recargo.eq(100) ? 'HORAS_EXTRA_100' : 'HORAS_EXTRA_50');
        return agregar(c, horas.times(valorHora).times(new D(1).plus(recargo.div(100))), { cantidad: horas });
      }
      case 'AUSENCIA': return agregar(c, valorDia.times(ausencias).neg(), { cantidad: ausencias });
      case 'FIJO': {
        const nov = novedades.find((n) => n.tipo === 'IMPORTE' && n.conceptoId === c.id);
        return agregar(c, nov?.importe ?? num(p, 'importe'));
      }
      default: return undefined;
    }
  };
  // Remunerativos (en orden), luego no remunerativos
  for (const c of ordenados) if (aplica(c) && c.clase === 'REMUNERATIVO') calcular(c);
  for (const c of ordenados) if (aplica(c) && c.clase === 'NO_REMUNERATIVO') calcular(c);
  let desc = descuentos(ordenados.filter(aplica), remu, noRemu, renglones, novedades);
  return { renglones, totalRemunerativo: remu, totalNoRemunerativo: noRemu, totalDescuentos: desc, neto: remu.plus(noRemu).minus(desc), diasTrabajados: dias, antiguedadAnios: anios };
}

/** Descuentos sobre el remunerativo (o remunerativo + no remunerativo), con tope de base opcional. */
function descuentos(conceptos: ConceptoCalc[], remu: Dec, noRemu: Dec, renglones: RenglonCalc[], novedades: NovedadCalc[]): Dec {
  let total = new D(0);
  for (const c of conceptos.filter((x) => x.clase === 'DESCUENTO')) {
    let importe: Dec;
    let base: Dec | null = null;
    if (c.tipo === 'DESCUENTO_LEY') {
      base = c.parametros.base === 'REMUNERATIVO_MAS_NO_REMUNERATIVO' ? remu.plus(noRemu) : remu;
      if (c.parametros.tope) base = D.min(base, new D(Number(c.parametros.tope)));
      importe = r2(base.times(num(c.parametros, 'pct')).div(100));
    } else if (c.tipo === 'FIJO') {
      const nov = novedades.find((n) => n.tipo === 'IMPORTE' && n.conceptoId === c.id);
      importe = r2(nov?.importe ?? num(c.parametros, 'importe'));
    } else continue;
    if (importe.isZero()) continue;
    renglones.push({ conceptoId: c.id, codigo: c.codigo, nombre: c.nombre, clase: c.clase, cantidad: null, base, porcentaje: c.tipo === 'DESCUENTO_LEY' ? num(c.parametros, 'pct') : null, importe, orden: c.orden });
    total = total.plus(importe);
  }
  return total;
}

/** Aguinaldo: 50 % de la mejor remuneración del semestre × días trabajados en el semestre / días del semestre (spec §5, §11.4). */
export function liquidarSac(e: EmpleadoCalc, conceptos: ConceptoCalc[], mejorRemunerativo: Dec, anio: number, semestre: 1 | 2): ResultadoCalc {
  const ini = new Date(Date.UTC(anio, semestre === 1 ? 0 : 6, 1)), fin = new Date(Date.UTC(anio, semestre === 1 ? 6 : 12, 0));
  const total = Math.round((fin.getTime() - ini.getTime()) / DIA) + 1;
  const desde = e.fechaIngreso > ini ? e.fechaIngreso : ini, hasta = e.fechaEgreso && e.fechaEgreso < fin ? e.fechaEgreso : fin;
  const dias = hasta < desde ? 0 : Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1;
  const sac = r2(new D(mejorRemunerativo).div(2).times(dias).div(total));
  const renglones: RenglonCalc[] = [];
  if (!sac.isZero()) renglones.push({ conceptoId: 'SAC', codigo: '200', nombre: 'SAC', clase: 'REMUNERATIVO', cantidad: new D(dias), base: new D(mejorRemunerativo), porcentaje: new D(50), importe: sac, orden: 200 });
  const aplicables = conceptos.filter((c) => c.tipo === 'DESCUENTO_LEY' && (!c.soloAfiliados || e.afiliadoSindicato)).sort((a, b) => a.orden - b.orden);
  const desc = descuentos(aplicables, sac, new D(0), renglones, []);
  return { renglones, totalRemunerativo: sac, totalNoRemunerativo: new D(0), totalDescuentos: desc, neto: sac.minus(desc), diasTrabajados: dias, antiguedadAnios: antiguedadAnios(e.fechaIngreso, fin) };
}

const ETIQUETA_TIPO: Record<ConceptoCalc['tipo'], string> = {
  BASICO: 'Sueldo básico', ANTIGUEDAD: 'Antigüedad', PORCENTAJE: 'Porcentaje', HORAS_EXTRA: 'Horas extra', AUSENCIA: 'Ausencia', FIJO: 'Importe fijo', DESCUENTO_LEY: 'Descuento de ley',
};
const ETIQUETA_CLASE: Record<ConceptoCalc['clase'], string> = { REMUNERATIVO: 'Remunerativo', NO_REMUNERATIVO: 'No remunerativo', DESCUENTO: 'Descuento' };
const CLASES_POR_TIPO: Record<ConceptoCalc['tipo'], ConceptoCalc['clase'][]> = {
  BASICO: ['REMUNERATIVO'], ANTIGUEDAD: ['REMUNERATIVO'], HORAS_EXTRA: ['REMUNERATIVO'], AUSENCIA: ['REMUNERATIVO'],
  PORCENTAJE: ['REMUNERATIVO', 'NO_REMUNERATIVO'], FIJO: ['REMUNERATIVO', 'NO_REMUNERATIVO', 'DESCUENTO'], DESCUENTO_LEY: ['DESCUENTO'],
};

/** Valida la clase y los parámetros de un concepto según su cálculo; devuelve el mensaje de error o null. */
export function validarConcepto(tipo: ConceptoCalc['tipo'], clase: ConceptoCalc['clase'], p: Record<string, unknown>): string | null {
  if (!CLASES_POR_TIPO[tipo].includes(clase)) return `El cálculo ${ETIQUETA_TIPO[tipo]} no admite la clase ${ETIQUETA_CLASE[clase]}`;
  const numero = (k: string, requerido: boolean) => {
    const v = p[k];
    if (v === undefined || v === null) return requerido ? `Parámetro ${k}: debe ser un número mayor o igual a cero` : null;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : `Parámetro ${k}: debe ser un número mayor o igual a cero`;
  };
  const opcion = (k: string, validas: string[]) => (p[k] === undefined || p[k] === null || validas.includes(String(p[k])) ? null : `Parámetro ${k} inválido`);
  switch (tipo) {
    case 'ANTIGUEDAD': return numero('pctPorAnio', true);
    case 'PORCENTAJE': return numero('pct', true) ?? opcion('base', ['BASICO_MAS_ANTIGUEDAD', 'REMUNERATIVO', 'BRUTO']) ?? (p.pierdeConAusencia === undefined || typeof p.pierdeConAusencia === 'boolean' ? null : 'Parámetro pierdeConAusencia inválido');
    case 'HORAS_EXTRA': return p.recargoPct === 50 || p.recargoPct === 100 ? null : 'Parámetro recargoPct: debe ser 50 o 100';
    case 'FIJO': return numero('importe', false);
    case 'DESCUENTO_LEY': return numero('pct', true) ?? opcion('base', ['REMUNERATIVO', 'REMUNERATIVO_MAS_NO_REMUNERATIVO']) ?? numero('tope', false);
    default: return null;
  }
}
