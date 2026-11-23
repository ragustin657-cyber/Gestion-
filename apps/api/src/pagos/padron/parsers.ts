export interface FilaPadron {
  cuit: string;
  vigenciaDesde: Date;
  vigenciaHasta: Date;
  alicuotaRetencion: string | null;
  alicuotaPercepcion: string | null;
}

function fecha(s: string): Date | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[1]) ? null : d;
}

function alicuota(s: string): string | null {
  const t = s.trim().replace(',', '.');
  return /^\d{1,3}(\.\d{1,6})?$/.test(t) ? t : null;
}

function invalida(nro: number, motivo: string): never {
  throw new Error(`Línea ${nro} inválida: ${motivo}`);
}

function comun(campos: string[], iDesde: number, iCuit: number, nro: number) {
  const vigenciaDesde = fecha(campos[iDesde] ?? '');
  const vigenciaHasta = fecha(campos[iDesde + 1] ?? '');
  const cuit = (campos[iCuit] ?? '').trim();
  if (!vigenciaDesde || !vigenciaHasta) invalida(nro, 'fecha de vigencia');
  if (!/^\d{11}$/.test(cuit)) invalida(nro, 'CUIT');
  return { cuit, vigenciaDesde, vigenciaHasta };
}

/** ARBA: Regimen;FechaPublicacion;VigenciaDesde;VigenciaHasta;CUIT;Tipo;MarcaAlta;MarcaAlicuota;Alicuota;Grupo */
export function parsearLineaArba(linea: string, nro: number): FilaPadron | null {
  if (!linea.trim()) return null;
  const c = linea.trim().split(';');
  if (c.length < 9) invalida(nro, 'cantidad de campos');
  const regimen = c[0].trim().toUpperCase();
  if (regimen !== 'R' && regimen !== 'P') invalida(nro, 'régimen');
  const a = alicuota(c[8]);
  if (a === null) invalida(nro, 'alícuota');
  return { ...comun(c, 2, 4, nro), alicuotaRetencion: regimen === 'R' ? a : null, alicuotaPercepcion: regimen === 'P' ? a : null };
}

/** AGIP: FechaPublicacion;VigenciaDesde;VigenciaHasta;CUIT;Tipo;MarcaAlta;MarcaAlicuota;AlicPercepcion;AlicRetencion;GrupoP;GrupoR;RazonSocial */
export function parsearLineaAgip(linea: string, nro: number): FilaPadron | null {
  if (!linea.trim()) return null;
  const c = linea.trim().split(';');
  if (c.length < 9) invalida(nro, 'cantidad de campos');
  const p = alicuota(c[7]);
  const r = alicuota(c[8]);
  if (p === null || r === null) invalida(nro, 'alícuota');
  return { ...comun(c, 1, 3, nro), alicuotaPercepcion: p, alicuotaRetencion: r };
}

/** Formato configurable del padrón (E48): separador y columnas, o ancho fijo con posiciones «desde-hasta». */
export interface FormatoPadronDef {
  separador: string; encabezado: boolean; cuit: string; alicuotaPercepcion: string | null; alicuotaRetencion: string | null;
  vigenciaDesde: string | null; vigenciaHasta: string | null; formatoFecha: string; separadorDecimal: string;
}

const FECHAS: Record<string, RegExp> = { DDMMAAAA: /^(\d{2})(\d{2})(\d{4})$/, 'DD/MM/AAAA': /^(\d{2})\/(\d{2})\/(\d{4})$/, AAAAMMDD: /^(\d{4})(\d{2})(\d{2})$/, 'AAAA-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/ };
function fechaConFormato(s: string, formato: string): Date | null {
  const m = FECHAS[formato]?.exec(s.trim());
  if (!m) return null;
  const [a, mes, d] = formato.startsWith('AAAA') ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const f = new Date(`${a}-${mes}-${d}T00:00:00Z`);
  return Number.isNaN(f.getTime()) || f.getUTCDate() !== Number(d) ? null : f;
}

/**
 * Línea de un padrón con formato configurable. Sin vigencia en el archivo, la del mes del período (AAAAMM).
 * El encabezado lo saltea quien lee el archivo (primera línea).
 */
export function parsearLineaConFormato(linea: string, nro: number, f: FormatoPadronDef, periodo?: string): FilaPadron | null {
  if (!linea.trim()) return null;
  const sep = f.separador === 'TAB' ? '\t' : f.separador;
  const campos = f.separador === 'FIJO' ? null : linea.replace(/\r$/, '').split(sep);
  const leer = (def: string | null): string | null => {
    if (!def) return null;
    if (!campos) {
      const [d, h] = def.split('-').map(Number);
      return linea.slice(d - 1, h).trim();
    }
    return (campos[Number(def) - 1] ?? '').trim();
  };
  const cuit = (leer(f.cuit) ?? '').replace(/-/g, '');
  if (!/^\d{11}$/.test(cuit)) invalida(nro, 'CUIT');
  const alic = (def: string | null) => {
    const v = leer(def);
    if (v === null || v === '') return null;
    const a = alicuota(f.separadorDecimal === ',' ? v.replace(/\./g, '').replace(',', '.') : v);
    if (a === null) invalida(nro, 'alícuota');
    return a;
  };
  const alicuotaRetencion = alic(f.alicuotaRetencion);
  const alicuotaPercepcion = alic(f.alicuotaPercepcion);
  if (alicuotaRetencion === null && alicuotaPercepcion === null) invalida(nro, 'alícuota');
  let vigenciaDesde: Date | null, vigenciaHasta: Date | null;
  if (f.vigenciaDesde) {
    vigenciaDesde = fechaConFormato(leer(f.vigenciaDesde) ?? '', f.formatoFecha);
    vigenciaHasta = f.vigenciaHasta ? fechaConFormato(leer(f.vigenciaHasta) ?? '', f.formatoFecha) : null;
  } else {
    if (!periodo || !/^\d{6}$/.test(periodo)) invalida(nro, 'vigencia (indique el período)');
    const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(4, 6));
    vigenciaDesde = new Date(Date.UTC(a, m - 1, 1));
    vigenciaHasta = new Date(Date.UTC(a, m, 0));
  }
  if (!vigenciaDesde || !vigenciaHasta) invalida(nro, 'fecha de vigencia');
  return { cuit, vigenciaDesde, vigenciaHasta, alicuotaRetencion, alicuotaPercepcion };
}
