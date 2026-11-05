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
