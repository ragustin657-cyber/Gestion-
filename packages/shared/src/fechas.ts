/** Fecha de "hoy" (YYYY-MM-DD) en la zona horaria indicada. */
export function hoyEn(zona: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';
