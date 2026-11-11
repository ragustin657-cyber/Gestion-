import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface FilaArca {
  fecha: string; tipo: number; puntoVenta: number; numero: number; documento: string;
  netoGravado: string | null; iva: string | null; total: string; moneda: string | null; tipoCambio: string | null;
}

type Columna = keyof FilaArca;
/** Nombres aceptados por columna (normalizados), y la etiqueta para el mensaje de faltantes. */
const COLUMNAS: { col: Columna; etiqueta: string; nombres: string[]; obligatoria: boolean }[] = [
  { col: 'fecha', etiqueta: 'Fecha', nombres: ['fecha', 'fecha de emision'], obligatoria: true },
  { col: 'tipo', etiqueta: 'Tipo', nombres: ['tipo', 'tipo de comprobante'], obligatoria: true },
  { col: 'puntoVenta', etiqueta: 'Punto de Venta', nombres: ['punto de venta'], obligatoria: true },
  { col: 'numero', etiqueta: 'Número Desde', nombres: ['numero desde', 'numero', 'numero de comprobante'], obligatoria: true },
  { col: 'documento', etiqueta: 'Nro. Doc.', nombres: ['nro doc emisor', 'nro doc receptor', 'nro doc', 'nro documento'], obligatoria: true },
  { col: 'total', etiqueta: 'Imp. Total', nombres: ['imp total', 'importe total'], obligatoria: true },
  { col: 'netoGravado', etiqueta: 'Imp. Neto Gravado', nombres: ['imp neto gravado', 'neto gravado total', 'neto gravado'], obligatoria: false },
  { col: 'iva', etiqueta: 'IVA', nombres: ['iva', 'total iva'], obligatoria: false },
  { col: 'moneda', etiqueta: 'Moneda', nombres: ['moneda'], obligatoria: false },
  { col: 'tipoCambio', etiqueta: 'Tipo Cambio', nombres: ['tipo cambio', 'tipo de cambio'], obligatoria: false },
];

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

function texto(buf: Buffer): string {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    t = buf.toString('latin1');
  }
  return t.replace(/^﻿/, '');
}

/** Campos de una línea CSV con comillas dobles. */
function campos(linea: string, sep: string): string[] {
  const r: string[] = [];
  let actual = '', comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; } else if (ch === '"') comillas = false; else actual += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { r.push(actual.trim()); actual = ''; } else actual += ch;
  }
  r.push(actual.trim());
  return r;
}

/** "1.234,56", "1234,56", "1234.56" o "U$S 100,00" → "1234.56" (si hay coma, el punto es separador de miles). null si no es un importe. */
export function importe(s: string): string | null {
  const limpio = s.replace(/U\$S/gi, '').replace(/[$\s]/g, '');
  if (!limpio) return '0.00';
  const n = limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio;
  if (!/^-?\d+(\.\d+)?$/.test(n)) return null;
  return new Prisma.Decimal(n).toFixed(2);
}

const fecha = (s: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
};

/** Lee el CSV de "Mis Comprobantes" (emitidos o recibidos) reconociendo las columnas por nombre. */
export function leerMisComprobantes(buf: Buffer): { filas: FilaArca[] } {
  const lineas = texto(buf).split(/\r?\n/).filter((l) => l.trim());
  const enc = lineas[0] ?? '';
  const sep = (enc.match(/;/g)?.length ?? 0) >= (enc.match(/,/g)?.length ?? 0) ? ';' : ',';
  const nombres = campos(enc, sep).map(normalizar);
  const indice = new Map<Columna, number>();
  for (const c of COLUMNAS) {
    const i = nombres.findIndex((n) => c.nombres.includes(n));
    if (i >= 0) indice.set(c.col, i);
  }
  const faltan = COLUMNAS.filter((c) => c.obligatoria && !indice.has(c.col)).map((c) => c.etiqueta);
  if (faltan.length) throw new BadRequestException(`Al CSV le faltan las columnas: ${faltan.join(', ')}`);
  const valor = (fs: string[], c: Columna) => (indice.has(c) ? fs[indice.get(c)!] ?? '' : null);
  const filas = lineas.slice(1).map((l) => {
    const fs = campos(l, sep);
    const neto = valor(fs, 'netoGravado'), iva = valor(fs, 'iva'), tc = valor(fs, 'tipoCambio');
    return {
      fecha: fecha(valor(fs, 'fecha')!), tipo: Number(/^\s*(\d+)/.exec(valor(fs, 'tipo')!)?.[1] ?? NaN), puntoVenta: Number(valor(fs, 'puntoVenta')),
      numero: Number(valor(fs, 'numero')), documento: valor(fs, 'documento')!.replace(/\D/g, ''), netoGravado: neto === null ? null : importe(neto),
      iva: iva === null ? null : importe(iva), total: importe(valor(fs, 'total')!) as string, moneda: valor(fs, 'moneda'), tipoCambio: tc === null || tc === '' ? null : importe(tc),
    };
  }).filter((f) => Number.isFinite(f.tipo) && f.tipo > 0 && Number.isFinite(f.numero) && f.numero > 0 && f.total !== null);
  return { filas };
}
