import { JURISDICCIONES_CM } from '@gestion/shared';

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Variantes comunes de la Ciudad y de la Provincia de Buenos Aires (ya normalizadas). */
const VARIANTES: Record<string, string> = {
  caba: '901', 'c a b a': '901', 'capital federal': '901', capital: '901', 'ciudad de buenos aires': '901', 'ciudad autonoma de buenos aires': '901',
  'cdad de buenos aires': '901', 'cdad autonoma de buenos aires': '901', 'ciudad autonoma de bs as': '901', 'cdad aut de bs as': '901',
  'bs as': '902', pba: '902', 'provincia de buenos aires': '902', 'pcia de buenos aires': '902', 'pcia buenos aires': '902', 'pcia de bs as': '902', 'pcia bs as': '902',
};
const NOMBRES: [string, string][] = Object.entries(JURISDICCIONES_CM).filter(([j]) => j !== '901').map(([j, n]) => [normalizar(n), j]);

/**
 * Jurisdicción de IIBB de la provincia de un tercero (spec E38 §7): `Tercero.provincia` es texto libre; se compara sin tildes,
 * mayúsculas ni signos contra los nombres y variantes comunes. Sin provincia o no reconocida → null.
 */
export function jurisdiccionDeProvincia(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = normalizar(texto);
  if (!t) return null;
  if (VARIANTES[t]) return VARIANTES[t];
  const sinPrefijo = t.replace(/^(provincia|pcia|prov)( de)? /, '');
  for (const [nombre, j] of NOMBRES) if (sinPrefijo === nombre || sinPrefijo.startsWith(`${nombre} `)) return j;
  return null;
}
