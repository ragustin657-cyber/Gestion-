/**
 * Valor de `trust proxy` de Express según TRUST_PROXY (E36). Sin valor, '0' o 'false': no se confía en X-Forwarded-For
 * (la API recibe conexiones directas). 'true' equivale a un salto; un número es la cantidad de saltos; cualquier otro
 * texto se pasa como lista de direcciones o subredes de confianza.
 */
export function confianzaProxy(valor: string | undefined): number | string | undefined {
  const v = valor?.trim().toLowerCase();
  if (!v || v === '0' || v === 'false') return undefined;
  if (v === 'true') return 1;
  if (/^\d+$/.test(v)) return Number(v);
  return valor!.trim();
}
