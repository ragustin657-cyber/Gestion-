import { BadRequestException } from '@nestjs/common';
import { filasCsv, numeroAR } from '../comun/csv';

export interface FilaIndice { anio: number; mes: number; valor: string }

const PERIODO = /^(?:(\d{4})-(\d{1,2})|(\d{1,2})\/(\d{4}))$/;

function periodo(t: string): { anio: number; mes: number } | null {
  const m = PERIODO.exec(t.trim());
  if (!m) return null;
  const anio = Number(m[1] ?? m[4]);
  const mes = Number(m[2] ?? m[3]);
  return mes >= 1 && mes <= 12 ? { anio, mes } : null;
}

/**
 * CSV de índices: período (AAAA-MM o MM/AAAA) y valor, separados por ';' o ','.
 * Con coma decimal el separador es ';'. Se ignoran las líneas vacías y una primera línea sin período (encabezado).
 */
export function parsearCsvIndices(texto: string): FilaIndice[] {
  const r: FilaIndice[] = [];
  const vistos = new Set<string>();
  let primera = true;
  filasCsv(texto).forEach((campos, i) => {
    if (!campos.length || campos.every((c) => !c)) return;
    const [p, v, ...resto] = campos;
    const per = periodo(p ?? '');
    const falla = (motivo: string) => new BadRequestException(`Línea ${i + 1}: ${motivo}`);
    const esPrimera = primera;
    primera = false;
    if (!per) {
      if (esPrimera && !/^\s*\d/.test(p ?? '')) return; // encabezado (no empieza con un número)
      throw falla('período inválido');
    }
    const val = resto.some((x) => x) ? null : numeroAR(v ?? '', campos.sep === ',');
    if (!val) throw falla('valor inválido');
    const clave = `${per.anio}-${per.mes}`;
    if (vistos.has(clave)) throw falla('período repetido');
    vistos.add(clave);
    r.push({ ...per, valor: val });
  });
  return r;
}
