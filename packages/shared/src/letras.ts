const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/** 0..999 en letras; `apocope` usa "un"/"veintiún"/"y un" (delante de mil o millón). */
function hasta999(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    let t: string;
    if (r < 30) t = UNIDADES[r];
    else t = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNIDADES[r % 10]}` : '');
    if (apocope) t = t.replace(/uno$/, 'un').replace(/veintiun$/, 'veintiún');
    partes.push(t);
  }
  return partes.join(' ');
}

function entero(n: number): string {
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : `${entero(millones).replace(/uno$/, 'un').replace(/veintiuno$/, 'veintiún')} millones`);
  if (miles) partes.push(miles === 1 ? 'mil' : `${hasta999(miles, true)} mil`);
  if (resto) partes.push(hasta999(resto, false));
  return partes.join(' ');
}

/** Importe en letras para recibos: `pesos novecientos cuarenta y un mil dieciséis con 82/100`. */
export function montoEnLetras(importe: string): string {
  const [ent, dec = ''] = importe.replace('-', '').split('.');
  const centavos = (dec + '00').slice(0, 2);
  return `pesos ${entero(Number(ent))} con ${centavos}/100`;
}
