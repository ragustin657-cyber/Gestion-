export const TIPOS_PRESENTACION = [
  { value: 'LIBRO_IVA_DIGITAL', label: 'Libro IVA Digital' },
  { value: 'SICORE', label: 'SICORE (Ganancias)' },
  { value: 'ARBA', label: 'ARBA A-122R (IIBB Buenos Aires)' },
  { value: 'AGIP', label: 'AGIP e-ARCIBA (IIBB CABA)' },
];
export const NOMBRE_PRESENTACION: Record<string, string> = Object.fromEntries(TIPOS_PRESENTACION.map((t) => [t.value, t.label]));
export const periodoTexto = (p: string, quincena = 0) => `${p.slice(4, 6)}/${p.slice(0, 4)}${quincena ? ` (${quincena}ª quincena)` : ''}`;
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));

/** Cuerpo del POST de generación: la quincena solo se envía donde se admite (SICORE: 1; ARBA: 1 o 2). */
export function cuerpoGenerar(tipo: string, anio: string, mes: string, quincena: string) {
  const q = Number(quincena);
  const admite = (tipo === 'SICORE' && q === 1) || (tipo === 'ARBA' && (q === 1 || q === 2));
  return { tipo, periodo: `${anio}${mes}`, quincena: admite ? q : null };
}
