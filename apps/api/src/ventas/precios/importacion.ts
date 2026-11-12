import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface FilaImportada { codigo: string; precio: string }

const numero = (t: string): string | null => {
  let s = t.trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) return null;
  return s;
};

/** Filas (código, precio) de un CSV (; o ,) o un XLSX. Encabezado opcional en la primera fila. Todo o nada. */
export async function leerPrecios(contenido: Buffer, nombre: string): Promise<FilaImportada[]> {
  let filas: string[][];
  if (/\.xlsx$/i.test(nombre)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(contenido as unknown as ArrayBuffer);
    filas = [];
    wb.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
      const v = row.values as unknown[];
      filas[row.number - 1] = [String(v[1] ?? ''), String(v[2] ?? '')];
    });
    filas = Array.from(filas, (f) => f ?? ['', '']);
  } else {
    filas = contenido.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => (l.includes(';') ? l.split(';') : l.split(',')));
  }
  const r: FilaImportada[] = [];
  const vistos = new Set<string>();
  filas.forEach(([codigo = '', precio = ''], i) => {
    if (!codigo.trim() && !precio.trim()) return;
    const p = numero(precio);
    if (i === 0 && p === null && !/\d/.test(precio)) return; // encabezado
    if (!p) throw new BadRequestException(`Línea ${i + 1}: precio inválido`);
    const c = codigo.trim();
    if (vistos.has(c)) throw new BadRequestException(`Línea ${i + 1}: artículo repetido`);
    vistos.add(c);
    r.push({ codigo: c, precio: p });
  });
  return r;
}
