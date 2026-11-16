import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const DIA = 86400000;

export type ClaseConcepto = 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO';
export type TipoConcepto = 'BASICO' | 'ANTIGUEDAD' | 'PORCENTAJE' | 'HORAS_EXTRA' | 'AUSENCIA' | 'FIJO' | 'DESCUENTO_LEY' | 'VACACIONES';
export interface ConceptoCalc { id: string; codigo: string; nombre: string; clase: ClaseConcepto; tipo: TipoConcepto; parametros: Record<string, unknown>; orden: number; soloAfiliados: boolean }
export interface EmpleadoCalc { fechaIngreso: Date; fechaEgreso: Date | null; afiliadoSindicato: boolean; basicoMensual: Dec; horasMensuales: number }
export interface NovedadCalc { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string | null; cantidad?: Dec | null; importe?: Dec | null }
export interface RenglonCalc { conceptoId: string; codigo: string; nombre: string; clase: ClaseConcepto; cantidad: Dec | null; base: Dec | null; porcentaje: Dec | null; importe: Dec; orden: number; vacacionPeriodoId?: string }
export interface VacacionCalc { periodoId: string; dias: number }
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
export function liquidarMes(e: EmpleadoCalc, conceptos: ConceptoCalc[], novedades: NovedadCalc[], anio: number, mes: number, baseMaxima: Dec | null = null, vacaciones: VacacionCalc[] = []): ResultadoCalc {
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
      case 'VACACIONES': {
        // Vacaciones (divisor 25) y descuento de sus días (divisor 30, negativo) con básico + antigüedad del mes completo
        const divisor = num(p, 'divisor');
        if (divisor.lte(0)) return undefined;
        // Solo con el pago y el descuento activos: uno sin el otro descontaría días sin pagarlos (o pagaría de más)
        const vac = conceptos.filter((x) => x.tipo === 'VACACIONES');
        if (!vac.some((x) => x.parametros.descuenta === true) || !vac.some((x) => x.parametros.descuenta !== true)) return undefined;
        const signo = p.descuenta === true ? -1 : 1;
        for (const v of vacaciones) agregar(c, new D(e.basicoMensual).plus(antigCompleta).div(divisor).times(v.dias).times(signo), { cantidad: new D(v.dias), vacacionPeriodoId: v.periodoId });
        return undefined;
      }
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
  const desc = descuentos(ordenados.filter(aplica), remu, noRemu, renglones, novedades, baseMaxima);
  return { renglones, totalRemunerativo: remu, totalNoRemunerativo: noRemu, totalDescuentos: desc, neto: remu.plus(noRemu).minus(desc), diasTrabajados: dias, antiguedadAnios: anios };
}

/** Descuentos sobre el remunerativo (o remunerativo + no remunerativo), con tope de base opcional. */
function descuentos(conceptos: ConceptoCalc[], remu: Dec, noRemu: Dec, renglones: RenglonCalc[], novedades: NovedadCalc[], baseMaxima: Dec | null): Dec {
  let total = new D(0);
  for (const c of conceptos.filter((x) => x.clase === 'DESCUENTO')) {
    let importe: Dec;
    let base: Dec | null = null;
    if (c.tipo === 'DESCUENTO_LEY') {
      base = c.parametros.base === 'REMUNERATIVO_MAS_NO_REMUNERATIVO' ? remu.plus(noRemu) : remu;
      if (c.parametros.tope === 'BASE_MAXIMA') { if (baseMaxima) base = D.min(base, baseMaxima); }
      else if (typeof c.parametros.tope === 'number' && c.parametros.tope > 0) base = D.min(base, new D(c.parametros.tope));
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
export function liquidarSac(e: EmpleadoCalc, conceptos: ConceptoCalc[], mejorRemunerativo: Dec, anio: number, semestre: 1 | 2, baseMaxima: Dec | null = null): ResultadoCalc {
  const ini = new Date(Date.UTC(anio, semestre === 1 ? 0 : 6, 1)), fin = new Date(Date.UTC(anio, semestre === 1 ? 6 : 12, 0));
  const total = Math.round((fin.getTime() - ini.getTime()) / DIA) + 1;
  const desde = e.fechaIngreso > ini ? e.fechaIngreso : ini, hasta = e.fechaEgreso && e.fechaEgreso < fin ? e.fechaEgreso : fin;
  const dias = hasta < desde ? 0 : Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1;
  const sac = r2(new D(mejorRemunerativo).div(2).times(dias).div(total));
  const renglones: RenglonCalc[] = [];
  if (!sac.isZero()) renglones.push({ conceptoId: 'SAC', codigo: '200', nombre: 'SAC', clase: 'REMUNERATIVO', cantidad: new D(dias), base: new D(mejorRemunerativo), porcentaje: new D(50), importe: sac, orden: 200 });
  const aplicables = conceptos.filter((c) => c.tipo === 'DESCUENTO_LEY' && (!c.soloAfiliados || e.afiliadoSindicato)).sort((a, b) => a.orden - b.orden);
  const desc = descuentos(aplicables, sac, new D(0), renglones, [], baseMaxima ? baseMaxima.div(2) : null);
  return { renglones, totalRemunerativo: sac, totalNoRemunerativo: new D(0), totalDescuentos: desc, neto: sac.minus(desc), diasTrabajados: dias, antiguedadAnios: antiguedadAnios(e.fechaIngreso, fin) };
}

const ETIQUETA_TIPO: Record<ConceptoCalc['tipo'], string> = {
  BASICO: 'Sueldo básico', ANTIGUEDAD: 'Antigüedad', PORCENTAJE: 'Porcentaje', HORAS_EXTRA: 'Horas extra', AUSENCIA: 'Ausencia', FIJO: 'Importe fijo', DESCUENTO_LEY: 'Descuento de ley', VACACIONES: 'Vacaciones',
};
const ETIQUETA_CLASE: Record<ConceptoCalc['clase'], string> = { REMUNERATIVO: 'Remunerativo', NO_REMUNERATIVO: 'No remunerativo', DESCUENTO: 'Descuento' };
const CLASES_POR_TIPO: Record<ConceptoCalc['tipo'], ConceptoCalc['clase'][]> = {
  BASICO: ['REMUNERATIVO'], ANTIGUEDAD: ['REMUNERATIVO'], HORAS_EXTRA: ['REMUNERATIVO'], AUSENCIA: ['REMUNERATIVO'],
  PORCENTAJE: ['REMUNERATIVO', 'NO_REMUNERATIVO'], FIJO: ['REMUNERATIVO', 'NO_REMUNERATIVO', 'DESCUENTO'], DESCUENTO_LEY: ['DESCUENTO'], VACACIONES: ['REMUNERATIVO'],
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
    case 'VACACIONES': return typeof p.divisor === 'number' && p.divisor > 0 ? null : 'Parámetro divisor: debe ser un número mayor que cero';
    case 'DESCUENTO_LEY': return numero('pct', true) ?? opcion('base', ['REMUNERATIVO', 'REMUNERATIVO_MAS_NO_REMUNERATIVO']) ?? (typeof p.tope === 'string' ? (p.tope === 'BASE_MAXIMA' ? null : 'Parámetro tope inválido') : numero('tope', false));
    default: return null;
  }
}

export type DestinoContribucion = 'SEGURIDAD_SOCIAL' | 'OBRA_SOCIAL' | 'ART' | 'SEGURO_VIDA';
export interface ContribucionCalc { codigo: string; nombre: string; destino: DestinoContribucion; alicuota: Dec; importeFijo: Dec; aplicaDetraccion: boolean; cuentaContableId: string }
export interface ContribucionResultado { codigo: string; nombre: string; destino: DestinoContribucion; base: Dec; alicuota: Dec; importe: Dec; cuentaContableId: string }

/**
 * Contribuciones patronales de un recibo (spec E19 §2): base = remunerativo, menos la detracción (proporcional a los días
 * en el mensual, 50 % en el SAC) si corresponde; importe = base × alícuota + fijo (el fijo solo en el mensual). Omite los 0.
 */
export function calcularContribuciones(remunerativo: Dec, diasTrabajados: number, tipo: 'MENSUAL' | 'SAC' | 'FINAL', contribuciones: ContribucionCalc[], detraccion: Dec, sac: Dec = new D(0)): ContribucionResultado[] {
  if (tipo !== 'SAC' && diasTrabajados <= 0) return [];
  const rem = D.max(new D(remunerativo), 0);
  // Final: proporcional a los días del mes, más el 50 % si incluye SAC (spec E20 §9.6); nunca más que el remunerativo
  const det = D.min(rem, r2(tipo === 'SAC' ? new D(detraccion).div(2) : new D(detraccion).times(diasTrabajados).div(30).plus(tipo === 'FINAL' && new D(sac).gt(0) ? new D(detraccion).div(2) : 0)));
  const out: ContribucionResultado[] = [];
  for (const c of contribuciones) {
    const base = c.aplicaDetraccion ? D.max(rem.minus(det), 0) : rem;
    const importe = r2(base.times(c.alicuota).div(100)).plus(tipo !== 'SAC' ? c.importeFijo : 0);
    if (importe.isZero()) continue;
    out.push({ codigo: c.codigo, nombre: c.nombre, destino: c.destino, base, alicuota: new D(c.alicuota), importe: r2(importe), cuentaContableId: c.cuentaContableId });
  }
  return out;
}

// ---------------------------------------------------------------- Liquidación final (Entrega 20)

export type CausaEgreso = 'RENUNCIA' | 'DESPIDO_SIN_CAUSA' | 'DESPIDO_CON_CAUSA' | 'MUTUO_ACUERDO';
export interface DatosFinal {
  causa: CausaEgreso; fechaEgreso: Date; preavisoOtorgado: boolean; mejorRemuneracion: Dec; mejorRemuneracionSemestre: Dec; topeIndemnizatorio: Dec | null; baseMaxima: Dec | null; gratificacion: Dec;
  /** Vacaciones (E21): pendientes de años anteriores, tomadas en el año del egreso, saldo inicial del año y períodos que empiezan en el mes del egreso. */
  diasVacacionesPendientesAnteriores?: number; diasVacacionesTomadosAnio?: number; saldoInicialAnio?: number | null; vacaciones?: VacacionCalc[];
}

/** Suma meses a una fecha, con el día recortado al último del mes de destino. */
function sumarMeses(f: Date, meses: number): Date {
  const y = f.getUTCFullYear(), m = f.getUTCMonth() + meses;
  // Un 29/02 que cae en febrero de un año no bisiesto pasa al 1/3, igual que el aniversario de antiguedadAnios
  if (f.getUTCMonth() === 1 && f.getUTCDate() === 29) return new Date(Date.UTC(y, m, 29));
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(f.getUTCDate(), ultimo)));
}

/** Antigüedad al egreso en años, meses y días (desde el último aniversario). */
export function antiguedadDetalle(ingreso: Date, egreso: Date): { anios: number; meses: number; dias: number } {
  const anios = antiguedadAnios(ingreso, egreso);
  const aniversario = sumarMeses(ingreso, anios * 12);
  let meses = 0;
  while (sumarMeses(aniversario, meses + 1) <= egreso) meses++;
  const dias = Math.round((egreso.getTime() - sumarMeses(aniversario, meses).getTime()) / DIA);
  return { anios, meses, dias };
}

/** Años indemnizables (art. 245): completos, más uno si la fracción supera 3 meses; mínimo 1. */
export function aniosIndemnizables(ingreso: Date, egreso: Date): number {
  const anios = antiguedadAnios(ingreso, egreso);
  const extra = egreso > sumarMeses(sumarMeses(ingreso, anios * 12), 3) ? 1 : 0;
  return Math.max(1, anios + extra);
}

/** Remuneración del mes completo (sin egreso ni novedades): base de la mejor remuneración. */
export function remuneracionMesCompleto(e: EmpleadoCalc, conceptos: ConceptoCalc[], anio: number, mes: number): Dec {
  return liquidarMes({ ...e, fechaEgreso: null }, conceptos, [], anio, mes).totalRemunerativo;
}

/** Liquidación final (spec E20 §4): días del mes, SAC proporcional, vacaciones no gozadas y, según la causa, indemnización, preaviso e integración. */
export function liquidarFinal(e: EmpleadoCalc, conceptos: ConceptoCalc[], novedades: NovedadCalc[], d: DatosFinal): ResultadoCalc {
  const eg = d.fechaEgreso;
  const anio = eg.getUTCFullYear(), mes = eg.getUTCMonth() + 1;
  const emp = { ...e, fechaEgreso: eg };
  const aplica = (c: ConceptoCalc) => !c.soloAfiliados || e.afiliadoSindicato;
  // Días del mes, sin descuentos (se calculan después con el SAC)
  const dias = liquidarMes(emp, conceptos.filter((c) => c.clase !== 'DESCUENTO'), novedades, anio, mes, null, d.vacaciones ?? []);
  const renglones = [...dias.renglones];
  let remu = dias.totalRemunerativo;
  const noRemuDias = dias.totalNoRemunerativo;
  // SAC proporcional del semestre hasta el egreso
  const sem = mes <= 6 ? 1 : 2;
  const iniSem = new Date(Date.UTC(anio, sem === 1 ? 0 : 6, 1)), finSem = new Date(Date.UTC(anio, sem === 1 ? 6 : 12, 0));
  const totalSem = Math.round((finSem.getTime() - iniSem.getTime()) / DIA) + 1;
  const desdeSem = e.fechaIngreso > iniSem ? e.fechaIngreso : iniSem;
  const diasSem = eg < desdeSem ? 0 : Math.round((eg.getTime() - desdeSem.getTime()) / DIA) + 1;
  const sac = r2(new D(d.mejorRemuneracionSemestre).div(2).times(diasSem).div(totalSem));
  if (!sac.isZero()) {
    renglones.push({ conceptoId: 'SAC', codigo: '200', nombre: 'SAC proporcional', clase: 'REMUNERATIVO', cantidad: new D(diasSem), base: new D(d.mejorRemuneracionSemestre), porcentaje: new D(50), importe: sac, orden: 200 });
    remu = remu.plus(sac);
  }
  // Descuentos sobre días + SAC (nunca sobre los conceptos indemnizatorios)
  const desc = descuentos(conceptos.filter(aplica).sort((a, b) => a.orden - b.orden), remu, noRemuDias, renglones, novedades, d.baseMaxima ? new D(d.baseMaxima).times(1.5) : null);
  // Conceptos indemnizatorios, no remunerativos
  let noRemu = noRemuDias;
  const agregar = (codigo: string, nombre: string, importe: Dec, extra: Partial<RenglonCalc> = {}) => {
    const imp = r2(importe);
    if (imp.isZero()) return imp;
    renglones.push({ conceptoId: 'FINAL', codigo, nombre, clase: 'NO_REMUNERATIVO', cantidad: null, base: null, porcentaje: null, importe: imp, orden: Number(codigo), ...extra });
    noRemu = noRemu.plus(imp);
    return imp;
  };
  const mejor = new D(d.mejorRemuneracion);
  const ant = antiguedadDetalle(e.fechaIngreso, eg);
  if (d.causa === 'DESPIDO_SIN_CAUSA') {
    let base = mejor;
    if (d.topeIndemnizatorio && mejor.gt(d.topeIndemnizatorio)) base = D.max(new D(d.topeIndemnizatorio), r2(mejor.times(0.67)));
    const anios = aniosIndemnizables(e.fechaIngreso, eg);
    agregar('300', 'Indemnización por antigüedad', base.times(anios), { cantidad: new D(anios), base });
    if (!d.preavisoOtorgado) {
      const meses = eg <= sumarMeses(e.fechaIngreso, 3) ? new D(0.5) : ant.anios < 5 || (ant.anios === 5 && ant.meses === 0 && ant.dias === 0) ? new D(1) : new D(2);
      const pre = agregar('310', 'Preaviso', mejor.times(meses), { cantidad: meses, base: mejor });
      agregar('311', 'SAC sobre preaviso', pre.div(12));
      const ultimoDia = finDeMes(anio, mes).getUTCDate();
      const restantes = Math.min(30, ultimoDia - eg.getUTCDate());
      if (restantes > 0) {
        const integ = agregar('320', 'Integración mes de despido', mejor.div(30).times(restantes), { cantidad: new D(restantes), base: mejor });
        agregar('321', 'SAC sobre integración', integ.div(12));
      }
    }
  }
  // Vacaciones no gozadas proporcionales
  const diasVac = ant.anios < 5 ? 14 : ant.anios < 10 ? 21 : ant.anios < 20 ? 28 : 35;
  const iniAnio = new Date(Date.UTC(anio, 0, 1));
  const desdeAnio = e.fechaIngreso > iniAnio ? e.fechaIngreso : iniAnio;
  const diasAnio = Math.round((eg.getTime() - desdeAnio.getTime()) / DIA) + 1;
  // Pendientes de años anteriores + proporcional del año del egreso menos lo tomado ese año (E21 §6)
  const proporcional = new D(d.saldoInicialAnio ?? diasVac).times(diasAnio).div(365);
  const diasNoGozados = new D(d.diasVacacionesPendientesAnteriores ?? 0).plus(D.max(proporcional.minus(d.diasVacacionesTomadosAnio ?? 0), 0));
  const vac = agregar('330', 'Vacaciones no gozadas', mejor.div(25).times(diasNoGozados), { cantidad: r2(diasNoGozados), base: mejor });
  agregar('331', 'SAC sobre vacaciones', vac.div(12));
  if (d.causa === 'MUTUO_ACUERDO') agregar('340', 'Gratificación por cese', new D(d.gratificacion));
  return { renglones, totalRemunerativo: remu, totalNoRemunerativo: noRemu, totalDescuentos: desc, neto: remu.plus(noRemu).minus(desc), diasTrabajados: dias.diasTrabajados, antiguedadAnios: ant.anios };
}

/** Días de vacaciones que corresponden por un año (spec E21 §3): banda por antigüedad al 31/12, o 1 cada 20 trabajados si son menos de 183. */
export function diasVacacionesCorresponden(ingreso: Date, egreso: Date | null, anio: number): number {
  const ini = new Date(Date.UTC(anio, 0, 1)), fin = new Date(Date.UTC(anio, 11, 31));
  const desde = ingreso > ini ? ingreso : ini, hasta = egreso && egreso < fin ? egreso : fin;
  if (hasta < desde) return 0;
  const trabajados = Math.round((hasta.getTime() - desde.getTime()) / DIA) + 1;
  if (trabajados < 183) return Math.floor(trabajados / 20);
  const anios = antiguedadAnios(ingreso, fin);
  return anios < 5 ? 14 : anios < 10 ? 21 : anios < 20 ? 28 : 35;
}
