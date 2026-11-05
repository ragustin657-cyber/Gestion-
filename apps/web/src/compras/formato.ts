import { hoyEn } from '@gestion/shared';

/** "$ 1.234,56" o "US$ 1.234,56" a partir de un importe en texto o número. */
export function formatoMoneda(importe: string | number | null | undefined, moneda = 'ARS'): string {
  const n = Number(importe ?? 0);
  const s = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${moneda === 'USD' ? 'US$' : '$'} ${s}`;
}

/** '2026-11-05' (o ISO completo) → '05/11/2026'. */
export function formatoFecha(f: string | null | undefined): string {
  if (!f) return '';
  return f.slice(0, 10).split('-').reverse().join('/');
}

/** Punto de venta y número → '00001-00001234'. */
export const formatoNumero = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;

/** Número de OC/IR (punto de venta 1, 4 dígitos) o '—' si no tiene. */
export const numeroInterno = (n: number | null | undefined) => (n ? `0001-${String(n).padStart(8, '0')}` : '—');

/** Fecha de hoy en la zona horaria del navegador (no en UTC). */
export const hoy = () => hoyEn(Intl.DateTimeFormat().resolvedOptions().timeZone);

export const ESTADOS_OC: Record<string, { etiqueta: string; color: string }> = {
  BORRADOR: { etiqueta: 'Borrador', color: 'gray' },
  PENDIENTE_APROBACION: { etiqueta: 'Pendiente de aprobación', color: 'yellow' },
  APROBADA: { etiqueta: 'Aprobada', color: 'blue' },
  PARCIALMENTE_RECIBIDA: { etiqueta: 'Parcialmente recibida', color: 'cyan' },
  CUMPLIDA: { etiqueta: 'Cumplida', color: 'green' },
  ANULADA: { etiqueta: 'Anulada', color: 'red' },
};
