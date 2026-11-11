import { BadRequestException } from '@nestjs/common';

export interface FilaIndice { anio: number; mes: number; valor: string }

const PERIODO = /^(?:(\d{4})-(\d{1,2})|(\d{1,2})\/(\d{4}))$/;

function periodo(t: string): { anio: number; mes: number } | null {
  const m = PERIODO.exec(t.trim());
  if (!m) return null;
  const anio = Number(m[1] ?? m[4]);
  const mes = Number(m[2] ?? m[3]);
  return mes >= 1 && mes <= 12 ? { anio, mes } : null;
}

/** Valor positivo con punto o coma decimal, normalizado con punto ('55,5' → '55.5'). */
function valor(t: string): string | null {
  const v = t.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) return null;
  return v.replace(/^0+(?=\d)/, '');
}

/**
 * CSV de índices: período (AAAA-MM o MM/AAAA) y valor, separados por ';' o ','.
 * Con coma decimal el separador es ';'. Se ignoran las líneas vacías y una primera línea sin período (encabezado).
 */
export function parsearCsvIndices(texto: string): FilaIndice[] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const r: FilaIndice[] = [];
  const vistos = new Set<string>();
  lineas.forEach((linea, i) => {
    if (!linea.trim()) return;
    const sep = linea.includes(';') ? ';' : ',';
    const [p, v, ...resto] = linea.split(sep);
    const per = periodo(p ?? '');
    const falla = (motivo: string) => new BadRequestException(`Línea ${i + 1}: ${motivo}`);
    if (!per) {
      if (i === 0 && !/^\s*\d/.test(p ?? '')) return; // encabezado (no empieza con un número)
      throw falla('período inválido');
    }
    const val = resto.length ? null : valor(v ?? '');
    if (!val) throw falla('valor inválido');
    const clave = `${per.anio}-${per.mes}`;
    if (vistos.has(clave)) throw falla('período repetido');
    vistos.add(clave);
    r.push({ ...per, valor: val });
  });
  return r;
}
