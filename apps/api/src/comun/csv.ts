/** Filas de un CSV con ';' o ',' (detectado por línea), campos entre comillas ("" escapa una comilla) y BOM. Conserva las líneas vacías como []. */
export type FilaCsv = string[] & { sep?: ';' | ',' };

export function filasCsv(texto: string): FilaCsv[] {
  return texto.replace(/^\uFEFF/, '').split(/\r?\n/).map((linea): FilaCsv => {
    if (!linea.trim()) return [];
    const sep = linea.includes(';') ? ';' : ',';
    const campos: string[] = [];
    let actual = '';
    let comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; } else if (c === '"') comillas = false; else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) { campos.push(actual); actual = ''; } else actual += c;
    }
    campos.push(actual);
    // Separadores finales sobrantes ("2025-06;50;")
    while (campos.length > 2 && !campos[campos.length - 1].trim()) campos.pop();
    return Object.assign(campos.map((x) => x.trim()), { sep: sep as ';' | ',' });
  });
}

/** Número positivo en formato argentino ("1.234,50", "2.500", "2,5") o con punto decimal ("2.5"). Ambiguo o inválido: null. */
export function numeroAR(t: string, puntoDecimal = false): string | null {
  let s = t.trim().replace(/\s/g, '');
  // Con coma como separador de campos, o un número que vino de una celda de Excel, el punto solo puede ser decimal
  if (puntoDecimal) {
    if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) return null;
    return s.replace(/^0+(?=\d)/, '');
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (!/^\d+(\.\d+)?$/.test(s)) return null;
  if (Number(s) <= 0) return null;
  return s.replace(/^0+(?=\d)/, '');
}
