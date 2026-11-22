import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Amortización impositiva de bienes de uso (Ganancias, spec E44 §3). Cálculo puro: lo reutiliza la DJ de Ganancias. */
export type TipoImpositivo = 'MUEBLE' | 'INMUEBLE' | 'AUTOMOVIL' | 'NO_AMORTIZABLE';
export interface EjercicioFiscal { desde: Date; hasta: Date }
export interface BienImpositivo { fechaAlta: Date; fechaBaja: Date | null; valorOrigen: Dec; valorTerreno: Dec; tipo: TipoImpositivo; vidaUtilAnios: number }
export interface ContextoImpositivo { ejercicios: EjercicioFiscal[]; indice: (mes: string) => Dec; topeAutomoviles: Dec }
export interface ResultadoImpositivo {
  actualiza: boolean; coeficiente: Dec; valorActualizado: Dec; aniosAnteriores: number; acumuladaAnterior: Dec; cuota: Dec; noDeducible: Dec;
  acumuladaCierre: Dec; valorResidual: Dec; costoComputableBaja: Dec | null;
}

/** Desde los ejercicios iniciados el 1/1/2018 los bienes se actualizan por IPC (art. 87 y 93). */
const INICIO_ACTUALIZACION = Date.UTC(2018, 0, 1);
const mes = (d: Date) => d.toISOString().slice(0, 7);
const r2 = (x: Dec) => x.toDecimalPlaces(2);
const enEjercicio = (e: EjercicioFiscal, d: Date) => d >= e.desde && d <= e.hasta;

/**
 * Los ejercicios del sistema más los anteriores supuestos (12 meses, mismo mes de cierre que el primero) hasta cubrir `desde`:
 * así se cuentan los años de los bienes con alta anterior al primer ejercicio cargado.
 */
export function ejerciciosFiscales(delSistema: EjercicioFiscal[], desde: Date): EjercicioFiscal[] {
  const ejs = [...delSistema].sort((a, b) => a.desde.getTime() - b.desde.getTime());
  if (!ejs.length) throw new Error('No hay ejercicios');
  while (ejs[0].desde > desde) {
    const p = ejs[0].desde;
    ejs.unshift({ desde: new Date(Date.UTC(p.getUTCFullYear() - 1, p.getUTCMonth(), p.getUTCDate())), hasta: new Date(p.getTime() - 86400000) });
  }
  return ejs;
}

export function ejercicioDe(ejs: EjercicioFiscal[], fecha: Date): EjercicioFiscal {
  const e = ejs.find((x) => enEjercicio(x, fecha));
  if (!e) throw new Error(`Sin ejercicio para ${fecha.toISOString().slice(0, 10)}`);
  return e;
}

const posicion = (ejs: EjercicioFiscal[], e: EjercicioFiscal) => ejs.findIndex((x) => x.desde.getTime() === e.desde.getTime());
const actualiza = (b: BienImpositivo, ejs: EjercicioFiscal[]) => ejercicioDe(ejs, b.fechaAlta).desde.getTime() >= INICIO_ACTUALIZACION;
/** Mes del índice final: el de la baja si cae en el ejercicio, si no el de cierre. */
const mesFinal = (b: BienImpositivo, ej: EjercicioFiscal) => (b.fechaBaja && enEjercicio(ej, b.fechaBaja) ? mes(b.fechaBaja) : mes(ej.hasta));

/** Meses cuyos índices necesita el cálculo ([] si el bien no se actualiza). */
export function mesesQueActualiza(b: BienImpositivo, ej: EjercicioFiscal, ejs: EjercicioFiscal[]): string[] {
  return actualiza(b, ejs) ? [...new Set([mes(b.fechaAlta), mesFinal(b, ej)])] : [];
}

export function amortizacionImpositiva(b: BienImpositivo, ej: EjercicioFiscal, ctx: ContextoImpositivo): ResultadoImpositivo {
  const act = actualiza(b, ctx.ejercicios);
  const coeficiente = act ? ctx.indice(mesFinal(b, ej)).div(ctx.indice(mes(b.fechaAlta))) : new D(1);
  const valorActualizado = r2(new D(b.valorOrigen).times(coeficiente));
  const bajaEnEjercicio = !!b.fechaBaja && enEjercicio(ej, b.fechaBaja);
  const cero = new D(0);
  if (b.tipo === 'NO_AMORTIZABLE')
    return { actualiza: act, coeficiente, valorActualizado, aniosAnteriores: 0, acumuladaAnterior: cero, cuota: cero, noDeducible: cero, acumuladaCierre: cero, valorResidual: valorActualizado, costoComputableBaja: bajaEnEjercicio ? valorActualizado : null };

  // Inmuebles: sin el terreno; el año del alta, los trimestres desde el del alta (inclusive)
  const base = b.tipo === 'INMUEBLE' ? valorActualizado.minus(r2(new D(b.valorTerreno).times(coeficiente))) : valorActualizado;
  const ejAlta = ejercicioDe(ctx.ejercicios, b.fechaAlta);
  const mesesDesdeInicio = (b.fechaAlta.getUTCFullYear() - ejAlta.desde.getUTCFullYear()) * 12 + b.fechaAlta.getUTCMonth() - ejAlta.desde.getUTCMonth();
  const primeraFraccion = b.tipo === 'INMUEBLE' ? (4 - Math.floor(mesesDesdeInicio / 3)) / 4 : 1;
  // Cuotas redondeadas a 2 decimales: la del primer año sobre la base (con su fracción), las siguientes la anual
  const cuotaAnual = r2(base.div(b.vidaUtilAnios));
  const cuotaPrimera = r2(base.times(primeraFraccion).div(b.vidaUtilAnios));
  const k = posicion(ctx.ejercicios, ej) - posicion(ctx.ejercicios, ejAlta);
  const aniosAnteriores = k <= 0 ? 0 : primeraFraccion + (k - 1);
  const acumuladaAnterior = k <= 0 ? new D(0) : D.min(base, cuotaPrimera.plus(cuotaAnual.times(k - 1)));
  const resto = base.minus(acumuladaAnterior);
  let cuota: Dec;
  if (bajaEnEjercicio || k < 0) cuota = cero; // el ejercicio de la baja no se amortiza
  else if (k === 0) cuota = D.min(resto, cuotaPrimera);
  else if (aniosAnteriores + 1 >= b.vidaUtilAnios) cuota = resto; // último año: el remanente
  else cuota = D.min(cuotaAnual, resto);
  // Automóviles (art. 88 inc. l): deducible la amortización de un automóvil que costó el tope
  const noDeducible = b.tipo === 'AUTOMOVIL' ? cuota.minus(r2(cuota.times(D.min(1, new D(ctx.topeAutomoviles).div(b.valorOrigen))))) : cero;
  const acumuladaCierre = acumuladaAnterior.plus(cuota);
  return {
    actualiza: act, coeficiente, valorActualizado, aniosAnteriores, acumuladaAnterior, cuota, noDeducible, acumuladaCierre,
    valorResidual: valorActualizado.minus(acumuladaCierre), costoComputableBaja: bajaEnEjercicio ? valorActualizado.minus(acumuladaAnterior) : null,
  };
}
