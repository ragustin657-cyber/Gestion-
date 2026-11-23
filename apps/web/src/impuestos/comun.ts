export const TIPOS_PRESENTACION = [
  { value: 'LIBRO_IVA_DIGITAL', label: 'Libro IVA Digital' },
  { value: 'SICORE', label: 'SICORE (Ganancias)' },
  { value: 'ARBA', label: 'ARBA A-122R (IIBB Buenos Aires)' },
  { value: 'AGIP', label: 'AGIP e-ARCIBA (IIBB CABA)' },
  { value: 'SIRE_IVA', label: 'SIRE IVA (F.2005)' },
  { value: 'SIRE_SUSS', label: 'SIRE SUSS (F.2004)' },
  { value: 'ARBA_PERCEPCIONES', label: 'ARBA percepciones (IIBB Buenos Aires)' },
  { value: 'SIRE_GANANCIAS_EXTERIOR', label: 'SIRE Ganancias exterior (F.2003)' },
  { value: 'SIRE_IVA_ANULACIONES', label: 'SIRE IVA anulaciones (F.2005)' },
  { value: 'SIRCAR_RETENCIONES', label: 'SIRCAR retenciones (IIBB Convenio)' },
  { value: 'SIRCAR_PERCEPCIONES', label: 'SIRCAR percepciones (IIBB Convenio)' },
];
export const NOMBRE_PRESENTACION: Record<string, string> = Object.fromEntries(TIPOS_PRESENTACION.map((t) => [t.value, t.label]));
export const periodoTexto = (p: string, quincena = 0) => `${p.slice(4, 6)}/${p.slice(0, 4)}${quincena ? ` (${quincena}ª quincena)` : ''}`;
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));

/** Cuerpo del POST de generación: la quincena solo se envía donde se admite (SICORE: 1; ARBA: 1 o 2). */
export function cuerpoGenerar(tipo: string, anio: string, mes: string, quincena: string) {
  const q = Number(quincena);
  const admite = (tipo === 'SICORE' && q === 1) || ((tipo === 'ARBA' || tipo === 'ARBA_PERCEPCIONES') && (q === 1 || q === 2));
  return { tipo, periodo: `${anio}${mes}`, quincena: admite ? q : null };
}

/** Opciones de quincena: SICORE mes o 1ª quincena; ARBA según su periodicidad (mensual: sin opción; quincenal: 1ª o 2ª). */
export function quincenasPara(tipo: string, periodicidadArba: string): { value: string; label: string }[] {
  if (tipo === 'SICORE') return [{ value: '0', label: 'Mes completo' }, { value: '1', label: '1ª quincena' }];
  if ((tipo === 'ARBA' || tipo === 'ARBA_PERCEPCIONES') && periodicidadArba === 'QUINCENAL') return [{ value: '1', label: '1ª quincena' }, { value: '2', label: '2ª quincena' }];
  return [];
}
