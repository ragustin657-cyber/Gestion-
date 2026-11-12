import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { filasCsv, numeroAR } from '../../comun/csv';

export interface FilaImportada { codigo: string; precio: string; linea: number }

/** ¿La celda es un número (o una fórmula con resultado numérico)? */
function esNumero(v: unknown): boolean {
  if (typeof v === 'number') return true;
  return typeof v === 'object' && !!v && 'result' in v && typeof (v as { result: unknown }).result === 'number';
}

/** Texto de una celda de Excel: el resultado de las fórmulas y los números como texto. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v && 'result' in v) return celda((v as { result: unknown }).result);
  if (typeof v === 'object' && v && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  return String(v);
}

/** Filas (código, precio, línea del archivo) de un CSV o un XLSX. Encabezado opcional en la primera fila con datos. Todo o nada. */
export async function leerPrecios(contenido: Buffer, nombre: string): Promise<FilaImportada[]> {
  let filas: (string[] & { sep?: string; numerico?: boolean })[];
  if (/\.xlsx$/i.test(nombre)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(contenido as unknown as ArrayBuffer);
    filas = [];
    wb.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
      const v = row.values as unknown[];
      filas[row.number - 1] = Object.assign([celda(v[1]).trim(), celda(v[2]).trim(), ...v.slice(3).map((x) => celda(x).trim())], { numerico: esNumero(v[2]) });
    });
    filas = Array.from(filas, (f) => f ?? []);
  } else {
    filas = filasCsv(contenido.toString('utf8'));
  }
  const r: FilaImportada[] = [];
  const vistos = new Set<string>();
  let primera = true;
  filas.forEach((fila, i) => {
    const [codigo = '', precio = '', ...resto] = fila;
    if (!codigo && !precio) return;
    const esPrimera = primera;
    primera = false;
    const p = resto.some((x) => x) ? null : numeroAR(precio, fila.numerico || fila.sep === ',');
    if (esPrimera && p === null && !/\d/.test(precio)) return; // encabezado
    if (!p) throw new BadRequestException(`Línea ${i + 1}: precio inválido`);
    if (vistos.has(codigo)) throw new BadRequestException(`Línea ${i + 1}: artículo repetido`);
    vistos.add(codigo);
    r.push({ codigo, precio: p, linea: i + 1 });
  });
  return r;
}
