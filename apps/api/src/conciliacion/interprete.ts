import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export type FormatoFecha = 'DD/MM/AAAA' | 'DD-MM-AAAA' | 'AAAA-MM-DD';

export interface FormatoParseo {
  tipoArchivo: 'CSV' | 'XLSX';
  separador: string | null;
  hoja: string | null;
  filaInicio: number;
  formatoFecha: FormatoFecha;
  separadorDecimal: ',' | '.';
  columnaFecha: string;
  columnaConcepto: string;
  columnaReferencia: string | null;
  columnaSaldo: string | null;
  modoImporte: 'IMPORTE_CON_SIGNO' | 'DEBITO_CREDITO';
  columnaImporte: string | null;
  columnaDebito: string | null;
  columnaCredito: string | null;
}

export interface LineaParseada {
  fila: number;
  fecha: Date;
  concepto: string;
  referencia: string | null;
  importe: Dec;
  saldo: Dec | null;
}

export interface ResultadoParseo {
  lineas: LineaParseada[];
  errores: { fila: number; mensaje: string }[];
  advertencias: string[];
}

type Celda = string | number | Date | null;

/** Columna por número ("3") o letra ("C", "AB") → índice desde 0. */
export function indiceColumna(c: string): number {
  const t = c.trim().toUpperCase();
  if (/^\d+$/.test(t)) return Number(t) - 1;
  let n = 0;
  for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnaValida(c: string): boolean {
  return /^(\d{1,3}|[A-Za-z]{1,2})$/.test(c.trim()) && indiceColumna(c) >= 0;
}

/** Fecha en el formato indicado → Date UTC, o null si no existe (p. ej. 31/02). */
export function parsearFecha(texto: string, formato: FormatoFecha): Date | null {
  const s = texto.trim();
  const m = formato === 'AAAA-MM-DD' ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) : (formato === 'DD/MM/AAAA' ? /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/ : /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/).exec(s);
  if (!m) return null;
  let [a, mes, d] = formato === 'AAAA-MM-DD' ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[3]), Number(m[2]), Number(m[1])];
  if (a < 100) a += 2000;
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? f : null;
}

/** Importe en texto ("1.234,56", "(1.500,00)", "$ -20") → Decimal, o null si es ilegible. Vacío → null. */
export function parsearImporte(texto: string, separadorDecimal: ',' | '.'): Dec | null {
  let s = texto.trim().replace(/\$|US\$|ARS|USD|\s/g, '');
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negativo = !negativo;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negativo = !negativo;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  s = separadorDecimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = new D(s);
  return negativo ? v.neg() : v;
}

/** UTF-8 si es válido; si no, Latin-1 (habitual en los homebanking). */
function decodificar(buf: Buffer): string {
  const utf = buf.toString('utf8');
  return utf.includes('�') ? buf.toString('latin1') : utf.replace(/^﻿/, '');
}

/** CSV con comillas dobles (RFC 4180) → filas de celdas. */
function leerCsv(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) {
      fila.push(celda);
      celda = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += ch;
  }
  if (celda !== '' || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

function valorExcel(v: ExcelJS.CellValue): Celda {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('result' in v) return valorExcel(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

async function leerXlsx(buf: Buffer, hoja: string | null): Promise<Celda[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = hoja && /^\d+$/.test(hoja) ? wb.worksheets[Number(hoja) - 1] : hoja ? wb.getWorksheet(hoja) : wb.worksheets[0];
  if (!ws) throw new Error('hoja');
  const filas: Celda[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(valorExcel);
    filas[n - 1] = vals;
  });
  for (let i = 0; i < filas.length; i++) filas[i] ??= [];
  return filas;
}

const texto = (c: Celda | undefined): string => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();

function fechaCelda(c: Celda | undefined, formato: FormatoFecha): Date | null {
  if (c instanceof Date) return new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
  return parsearFecha(texto(c), formato);
}

function importeCelda(c: Celda | undefined, sep: ',' | '.'): Dec | null | 'invalido' {
  if (typeof c === 'number') return new D(c).toDecimalPlaces(2);
  const t = texto(c);
  if (!t) return null;
  return parsearImporte(t, sep) ?? 'invalido';
}

/** Interpreta un extracto bancario según el formato. No toca la base de datos. */
export async function parsearExtracto(archivo: Buffer, f: FormatoParseo): Promise<ResultadoParseo> {
  let filas: Celda[][];
  if (f.tipoArchivo === 'CSV') filas = leerCsv(decodificar(archivo), f.separador ?? ';');
  else {
    try {
      filas = await leerXlsx(archivo, f.hoja);
    } catch {
      return { lineas: [], errores: [{ fila: 0, mensaje: 'No se pudo leer el archivo Excel o la hoja indicada' }], advertencias: [] };
    }
  }
  const col = (fila: Celda[], c: string | null) => (c ? fila[indiceColumna(c)] : undefined);
  const lineas: LineaParseada[] = [];
  const errores: ResultadoParseo['errores'] = [];
  const advertencias: string[] = [];
  let omitidas = 0;
  for (let i = Math.max(0, f.filaInicio - 1); i < filas.length; i++) {
    const fila = filas[i];
    const numero = i + 1;
    if (!fila.some((c) => texto(c) !== '')) continue;
    let importe: Dec | null;
    if (f.modoImporte === 'IMPORTE_CON_SIGNO') {
      const v = importeCelda(col(fila, f.columnaImporte), f.separadorDecimal);
      if (v === 'invalido') {
        errores.push({ fila: numero, mensaje: 'Importe inválido' });
        continue;
      }
      importe = v;
    } else {
      const deb = importeCelda(col(fila, f.columnaDebito), f.separadorDecimal);
      const cred = importeCelda(col(fila, f.columnaCredito), f.separadorDecimal);
      if (deb === 'invalido' || cred === 'invalido') {
        errores.push({ fila: numero, mensaje: 'Importe inválido' });
        continue;
      }
      importe = deb === null && cred === null ? null : (cred ?? new D(0)).minus((deb ?? new D(0)).abs());
    }
    const fecha = fechaCelda(col(fila, f.columnaFecha), f.formatoFecha);
    if (!fecha) {
      errores.push({ fila: numero, mensaje: 'Fecha inválida' });
      continue;
    }
    if (importe === null || importe.isZero()) {
      omitidas++;
      continue;
    }
    let saldo: Dec | null = null;
    if (f.columnaSaldo) {
      const s = importeCelda(col(fila, f.columnaSaldo), f.separadorDecimal);
      saldo = s === 'invalido' ? null : s;
    }
    lineas.push({
      fila: numero, fecha, concepto: texto(col(fila, f.columnaConcepto)).replace(/\s+/g, ' '),
      referencia: texto(col(fila, f.columnaReferencia)) || null, importe, saldo,
    });
  }
  if (f.columnaSaldo)
    for (let i = 1; i < lineas.length; i++) {
      const a = lineas[i - 1];
      const b = lineas[i];
      if (a.saldo && b.saldo && !a.saldo.plus(b.importe).eq(b.saldo)) {
        advertencias.push(`El saldo de la fila ${b.fila} no coincide: revise el formato`);
        break;
      }
    }
  if (omitidas) advertencias.push(`Se omitieron ${omitidas} filas vacías o con importe cero`);
  return { lineas, errores, advertencias };
}
