import { ClaseConcepto, Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/**
 * Diseño de registro del Libro de Sueldos Digital (ARCA, "Conceptos básicos y guía de uso" 2.1, Anexos II y III; spec E30 §3).
 * N: numérico con ceros a la izquierda; C: alfanumérico con espacios a la derecha; I: decimal sin separador (2 decimales).
 */
export interface CampoLsd<T> { nombre: string; largo: number; tipo: 'N' | 'C' | 'I'; valor: (d: T) => string | number | Dec | null }

export interface Datos01 { cuit: string; periodo: string; numero: number; cantidad04: number }
export interface Datos02 { cuil: string; legajo: string; dependencia: string; cbu: string; diasTope: number; fechaPago: string; formaPago: '1' | '3' }
export interface Datos03 { cuil: string; codigo: string; cantidad: Dec | null; unidad: string; importe: Dec; dc: 'D' | 'C' }
export interface Datos04 {
  cuil: string; conyuge: boolean; hijos: number; cct: boolean; scvo: boolean; tipoEmpresa: number; situacion: number; condicion: number; actividad: number; modalidad: number;
  siniestrado: number; zona: number; diaInicio: number; dias: number; obraSocial: string; adherentes: number;
  remuneracionBruta: Dec; imponible1: Dec; imponible2: Dec; imponible3: Dec; imponible4: Dec; imponible5: Dec; imponible8: Dec; imponible9: Dec; base10: Dec; detraccion: Dec;
}
export interface DatosConceptoLsd { codigoArca: string; codigo: string; descripcion: string; clase: ClaseConcepto }

const c = <T>(nombre: string, largo: number, tipo: CampoLsd<T>['tipo'], valor: CampoLsd<T>['valor']): CampoLsd<T> => ({ nombre, largo, tipo, valor });
const fijo = (v: string) => () => v;
const b = (x: boolean) => (x ? '1' : '0');
const cero = () => 0;

export const REG01: CampoLsd<Datos01>[] = [
  c('Tipo de registro', 2, 'C', fijo('01')), c('CUIT del empleador', 11, 'N', (d) => d.cuit), c('Identificación del envío', 2, 'C', fijo('SJ')),
  c('Período', 6, 'N', (d) => d.periodo), c('Tipo de liquidación', 1, 'C', fijo('M')), c('Número de liquidación', 5, 'N', (d) => d.numero),
  c('Días base', 2, 'C', fijo('30')), c('Cantidad de registros 04', 6, 'N', (d) => d.cantidad04),
];

export const REG02: CampoLsd<Datos02>[] = [
  c('Tipo de registro', 2, 'C', fijo('02')), c('CUIL', 11, 'N', (d) => d.cuil), c('Legajo', 10, 'C', (d) => d.legajo), c('Dependencia de revista', 50, 'C', (d) => d.dependencia),
  c('CBU', 22, 'C', (d) => d.cbu), c('Días para proporcionar el tope', 3, 'N', (d) => d.diasTope), c('Fecha de pago', 8, 'N', (d) => d.fechaPago),
  c('Fecha de rúbrica', 8, 'C', fijo('')), c('Forma de pago', 1, 'C', (d) => d.formaPago),
];

export const REG03: CampoLsd<Datos03>[] = [
  c('Tipo de registro', 2, 'C', fijo('03')), c('CUIL', 11, 'N', (d) => d.cuil), c('Código de concepto', 10, 'C', (d) => d.codigo), c('Cantidad', 5, 'I', (d) => d.cantidad),
  c('Unidades', 1, 'C', (d) => d.unidad), c('Importe', 15, 'I', (d) => d.importe), c('Débito / Crédito', 1, 'C', (d) => d.dc), c('Período de ajuste retroactivo', 6, 'N', cero),
];

const i15 = (nombre: string, f: (d: Datos04) => Dec | number) => c<Datos04>(nombre, 15, 'I', f);
export const REG04: CampoLsd<Datos04>[] = [
  c('Tipo de registro', 2, 'C', fijo('04')), c('CUIL', 11, 'N', (d) => d.cuil), c('Cónyuge', 1, 'C', (d) => b(d.conyuge)), c('Cantidad de hijos', 2, 'N', (d) => d.hijos),
  c('Trabajador en CCT', 1, 'C', (d) => b(d.cct)), c('SCVO', 1, 'C', (d) => b(d.scvo)), c('Corresponde reducción', 1, 'C', fijo('0')),
  c('Tipo de empleador', 1, 'N', (d) => d.tipoEmpresa), c('Tipo de operación', 1, 'C', fijo('0')), c('Código de situación', 2, 'N', (d) => d.situacion),
  c('Código de condición', 2, 'N', (d) => d.condicion), c('Código de actividad', 3, 'N', (d) => d.actividad), c('Código de modalidad', 3, 'N', (d) => d.modalidad),
  c('Código de siniestrado', 2, 'N', (d) => d.siniestrado), c('Código de localidad', 2, 'N', (d) => d.zona), c('Situación de revista 1', 2, 'N', (d) => d.situacion),
  c('Día de inicio 1', 2, 'N', (d) => d.diaInicio), c('Situación de revista 2', 2, 'N', cero), c('Día de inicio 2', 2, 'N', cero), c('Situación de revista 3', 2, 'N', cero),
  c('Día de inicio 3', 2, 'N', cero), c('Días trabajados', 2, 'N', (d) => d.dias), c('Horas trabajadas', 3, 'N', cero), c('Aporte adicional SS', 5, 'I', cero),
  c('Contribución tarea diferencial', 5, 'I', cero), c('Obra social', 6, 'C', (d) => d.obraSocial), c('Adherentes', 2, 'N', (d) => d.adherentes),
  i15('Aporte adicional OS', cero), i15('Contribución adicional OS', cero), i15('Base diferencial aportes OS y FSR', cero), i15('Base diferencial contribuciones OS y FSR', cero),
  i15('Base diferencial LRT', cero), i15('Remuneración maternidad ANSeS', cero), i15('Remuneración bruta', (d) => d.remuneracionBruta),
  i15('Base imponible 1', (d) => d.imponible1), i15('Base imponible 2', (d) => d.imponible2), i15('Base imponible 3', (d) => d.imponible3), i15('Base imponible 4', (d) => d.imponible4),
  i15('Base imponible 5', (d) => d.imponible5), i15('Base imponible 6', cero), i15('Base imponible 7', cero), i15('Base imponible 8', (d) => d.imponible8),
  i15('Base imponible 9', (d) => d.imponible9), i15('Base diferencial aporte SS', cero), i15('Base diferencial contribución SS', cero),
  i15('Base imponible 10', (d) => d.base10), i15('Importe a detraer', (d) => d.detraccion),
];

/** Subsistemas de las posiciones 168 a 186 (Anexo II): null es una posición libre (en blanco). */
const SUBSISTEMAS_REMUNERATIVO: (0 | 1 | null)[] = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, null, 1, null, 1, null, 1, 0, null, 0];
export const marcas = (clase: ClaseConcepto) => SUBSISTEMAS_REMUNERATIVO.map((m) => (m === null ? ' ' : clase === 'REMUNERATIVO' ? String(m) : '0')).join('');

export const REG_CONCEPTO: CampoLsd<DatosConceptoLsd>[] = [
  c('Código de concepto ARCA', 6, 'C', (d) => d.codigoArca), c('Código de concepto del empleador', 10, 'C', (d) => d.codigo), c('Descripción', 150, 'C', (d) => d.descripcion),
  c('Marca de repetición', 1, 'C', fijo('0')), c('Subsistemas', 19, 'C', (d) => marcas(d.clase)), c('Libre', 9, 'C', fijo('')),
];

/** Arma una línea de largo fijo; un valor que no entra lanza "<campo>: valor fuera de rango". */
export function linea<T>(campos: CampoLsd<T>[], d: T): string {
  return campos.map((f) => {
    const v = f.valor(d);
    if (f.tipo === 'C') return String(v ?? '').slice(0, f.largo).padEnd(f.largo, ' ');
    const s = f.tipo === 'I' ? new D(v ?? 0).times(100).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0) : String(v ?? 0);
    if (!/^\d+$/.test(s) || s.length > f.largo) throw new Error(`${f.nombre}: valor fuera de rango`);
    return s.padStart(f.largo, '0');
  }).join('');
}
