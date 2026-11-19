import { ClaseConcepto, DestinoDescuento, TipoConcepto } from '@prisma/client';

/** Concepto mínimo para elegir su código ARCA (spec E30 §4.1). */
export interface ConceptoArca { codigo: string; clase: ClaseConcepto; tipo: TipoConcepto; parametros: unknown; destino: DestinoDescuento }

const num = (p: unknown, k: string) => Number((p as Record<string, unknown> | null)?.[k] ?? 0);

/** Código ARCA (Anexo I del Libro de Sueldos Digital) por defecto de un concepto. */
export function codigoArcaPorDefecto(c: ConceptoArca): string {
  if (c.tipo === 'GANANCIAS' || c.tipo === 'GANANCIAS_AJUSTE') return '810008';
  if (c.clase === 'DESCUENTO') {
    if (c.destino === 'SEGURIDAD_SOCIAL') return c.codigo === '510' ? '810001' : '810000';
    if (c.destino === 'OBRA_SOCIAL') return '810002';
    if (c.destino === 'SINDICAL') return '810004';
    return '820000';
  }
  if (c.clase === 'NO_REMUNERATIVO') return '550000';
  switch (c.tipo) {
    case 'BASICO': case 'AUSENCIA': return '110000';
    case 'ANTIGUEDAD': return '160001';
    case 'HORAS_EXTRA': return num(c.parametros, 'recargoPct') >= 100 ? '130002' : '130001';
    case 'VACACIONES': return (c.parametros as Record<string, unknown> | null)?.descuenta ? '110000' : '150000';
    default: return c.codigo === '120' && c.tipo === 'PORCENTAJE' ? '170001' : '160000';
  }
}

const RANGOS: Record<ClaseConcepto, [number, number, string]> = {
  REMUNERATIVO: [110000, 499999, 'remunerativo'], NO_REMUNERATIVO: [510000, 799999, 'no remunerativo'], DESCUENTO: [810000, 829999, 'descuento'],
};

/** Mensaje de error si el código no es de 6 dígitos dentro del rango de la clase; null si es válido. */
export function validarCodigoArca(codigo: string, clase: ClaseConcepto): string | null {
  const [desde, hasta, nombre] = RANGOS[clase];
  const n = /^\d{6}$/.test(codigo) ? Number(codigo) : NaN;
  return n >= desde && n <= hasta ? null : `El código ARCA ${codigo} no corresponde a un concepto ${nombre}`;
}

/** Renglones que arma el cálculo sin concepto (SAC y liquidación final), con su código ARCA fijo. */
export const RENGLONES_FIJOS: { codigo: string; nombre: string; codigoArca: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' }[] = [
  { codigo: '200', nombre: 'SAC', codigoArca: '120000', clase: 'REMUNERATIVO' },
  { codigo: '201', nombre: 'SAC proporcional', codigoArca: '120003', clase: 'REMUNERATIVO' },
  { codigo: '300', nombre: 'Indemnización por antigüedad', codigoArca: '520014', clase: 'NO_REMUNERATIVO' },
  { codigo: '310', nombre: 'Preaviso', codigoArca: '520015', clase: 'NO_REMUNERATIVO' },
  { codigo: '311', nombre: 'SAC sobre preaviso', codigoArca: '520017', clase: 'NO_REMUNERATIVO' },
  { codigo: '320', nombre: 'Integración mes de despido', codigoArca: '520016', clase: 'NO_REMUNERATIVO' },
  { codigo: '321', nombre: 'SAC sobre integración', codigoArca: '520017', clase: 'NO_REMUNERATIVO' },
  { codigo: '330', nombre: 'Vacaciones no gozadas', codigoArca: '520012', clase: 'NO_REMUNERATIVO' },
  { codigo: '331', nombre: 'SAC sobre vacaciones no gozadas', codigoArca: '520018', clase: 'NO_REMUNERATIVO' },
  { codigo: '340', nombre: 'Gratificación por cese', codigoArca: '520010', clase: 'NO_REMUNERATIVO' },
];
