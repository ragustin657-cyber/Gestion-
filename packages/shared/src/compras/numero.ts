/** Normaliza un número de comprobante "PV-NUMERO" a 00001-00001234. Devuelve null si es inválido. */
export function normalizarNumeroComprobante(s: string): string | null {
  const m = /^(\d{1,5})-(\d{1,8})$/.exec((s ?? '').trim());
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return null;
  return `${m[1].padStart(5, '0')}-${m[2].padStart(8, '0')}`;
}
