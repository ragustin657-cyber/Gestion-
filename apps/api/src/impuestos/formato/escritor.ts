import { Prisma } from '@prisma/client';
import type { Campo, Valor } from './campos';

const D = Prisma.Decimal;

export class ErrorFormato extends Error {
  constructor(readonly campo: string, readonly valor: Valor, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFormato';
  }
}

/** Sin diacríticos y solo ASCII imprimible (lo demás, espacio): lo que aceptan los aplicativos. */
export function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ' ');
}

const fecha = (v: Valor, formato: 'AAAAMMDD' | 'DD/MM/AAAA') => {
  if (v === null || v === undefined || v === '') return formato === 'AAAAMMDD' ? '00000000' : ' '.repeat(10);
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  const [a, m, dia] = d.toISOString().slice(0, 10).split('-');
  return formato === 'AAAAMMDD' ? `${a}${m}${dia}` : `${dia}/${m}/${a}`;
};

/** Una línea según el diseño. NUM/IMPORTE que no entran lanzan ErrorFormato; TXT largos se recortan con advertencia. */
export function linea(campos: Campo[], valores: Record<string, Valor>, registro?: number): { texto: string; advertencias: string[] } {
  const advertencias: string[] = [];
  const partes = campos.map((c) => {
    const v = valores[c.nombre];
    const desborde = (s: string) => new ErrorFormato(c.nombre, v, `El campo ${c.nombre} (${c.largo})${registro ? ` del registro ${registro}` : ''} no admite el valor ${s}`);
    switch (c.tipo) {
      case 'FIJO':
        return c.valor.padEnd(c.largo).slice(0, c.largo);
      case 'NUM': {
        const s = v === null || v === undefined || v === '' ? '0' : String(v).replace(/\D/g, '') || '0';
        if (s.length > c.largo) throw desborde(s);
        return s.padStart(c.largo, '0');
      }
      case 'TXT': {
        const s = sinAcentos(v === null || v === undefined ? '' : String(v));
        if (s.length > c.largo) advertencias.push(`El campo ${c.nombre} (${c.largo})${registro ? ` del registro ${registro}` : ''} se recortó`);
        return s.slice(0, c.largo).padEnd(c.largo);
      }
      case 'IMPORTE': {
        const n = new D(v === null || v === undefined || v === '' ? 0 : String(v));
        if (n.isNeg()) throw desborde(n.toString());
        const dec = c.decimales ?? 2;
        const fijo = n.toFixed(dec);
        const s = c.separador === '' ? fijo.replace('.', '') : fijo.replace('.', c.separador);
        if (s.length > c.largo) throw desborde(s);
        return s.padStart(c.largo, '0');
      }
      case 'FECHA':
        return fecha(v, c.formato);
    }
  });
  const texto = partes.join('');
  const esperado = campos.reduce((s, c) => s + c.largo, 0);
  if (texto.length !== esperado) throw new ErrorFormato('linea', texto.length, `La línea mide ${texto.length} y debería medir ${esperado}`);
  return { texto, advertencias };
}

/** Archivo latin1 con CRLF entre líneas y al final. */
export function archivo(lineas: string[]): Buffer {
  return Buffer.from(lineas.map((l) => `${l}\r\n`).join(''), 'latin1');
}
