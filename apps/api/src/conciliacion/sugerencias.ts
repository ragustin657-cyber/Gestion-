import type { Prisma } from '@prisma/client';

export interface Elemento {
  id: string;
  fecha: Date;
  /** Con signo: crédito/ingreso positivo, débito/egreso negativo. */
  importe: Prisma.Decimal;
  /** Texto donde buscar la referencia (para las líneas: referencia y concepto). */
  referencia: string | null;
}

export interface Sugerencia {
  lineas: string[];
  movimientos: string[];
  nivel: 'EXACTA' | 'PROBABLE' | 'AGRUPADA';
  preseleccionada: boolean;
}

const DIA = 86400000;
const MAX_GRUPO = 10;
const MAX_CANDIDATOS = 20;
const centavos = (e: Elemento) => Math.round(Number(e.importe) * 100);
const dias = (a: Date, b: Date) => Math.abs(Math.round((a.getTime() - b.getTime()) / DIA));
const sinCeros = (s: string) => s.replace(/^0+(?=\d)/, '');

/** Números presentes en un texto, sin ceros a la izquierda ("DEP 0045 / E-00001" → 45, 1). */
const numeros = (s: string | null) => (s?.match(/\d+/g) ?? []).map(sinCeros);

/** La referencia del movimiento aparece en el texto de la línea. */
function coincideReferencia(linea: Elemento, mov: Elemento): boolean {
  const ref = mov.referencia?.replace(/\D/g, '');
  if (!ref) return false;
  const buscado = sinCeros(ref);
  const enLinea = numeros(linea.referencia);
  return enLinea.includes(buscado) || sinCeros((linea.referencia ?? '').replace(/\D/g, '')) === buscado;
}

/** Subconjunto de 2 a MAX_GRUPO elementos que suma exactamente el objetivo (en centavos), o null. */
function subconjunto(candidatos: Elemento[], objetivo: number): Elemento[] | null {
  const lista = [...candidatos].sort((a, b) => Math.abs(centavos(b)) - Math.abs(centavos(a))).slice(0, MAX_CANDIDATOS);
  const valores = lista.map(centavos);
  const elegido: number[] = [];
  const buscar = (i: number, resto: number): boolean => {
    if (resto === 0) return elegido.length >= 2;
    if (i >= lista.length || elegido.length >= MAX_GRUPO) return false;
    for (let j = i; j < lista.length; j++) {
      if (Math.abs(valores[j]) > Math.abs(resto)) continue;
      elegido.push(j);
      if (buscar(j + 1, resto - valores[j])) return true;
      elegido.pop();
    }
    return false;
  };
  return buscar(0, objetivo) ? elegido.map((j) => lista[j]) : null;
}

/**
 * Coincidencias entre líneas del extracto y movimientos del sistema, en tres pasadas
 * (exacta, probable y agrupada). Cada elemento se usa como máximo en una sugerencia.
 */
export function sugerir(lineas: Elemento[], movimientos: Elemento[], toleranciaDias: number): Sugerencia[] {
  const r: Sugerencia[] = [];
  const usadasL = new Set<string>();
  const usadosM = new Set<string>();
  const libresL = () => lineas.filter((l) => !usadasL.has(l.id)).sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  const libresM = () => movimientos.filter((m) => !usadosM.has(m.id));
  const agregar = (ls: Elemento[], ms: Elemento[], nivel: Sugerencia['nivel']) => {
    ls.forEach((l) => usadasL.add(l.id));
    ms.forEach((m) => usadosM.add(m.id));
    r.push({ lineas: ls.map((l) => l.id), movimientos: ms.map((m) => m.id), nivel, preseleccionada: nivel === 'EXACTA' });
  };

  // 1. Exacta: mismo importe y (referencia o misma fecha); gana la referencia y después la fecha más cercana
  for (const l of libresL()) {
    const c = libresM()
      .filter((m) => centavos(m) === centavos(l) && (coincideReferencia(l, m) || dias(l.fecha, m.fecha) === 0))
      .sort((a, b) => Number(coincideReferencia(l, b)) - Number(coincideReferencia(l, a)) || dias(l.fecha, a.fecha) - dias(l.fecha, b.fecha));
    if (c.length) agregar([l], [c[0]], 'EXACTA');
  }

  // 2. Probable: mismo importe, dentro de la tolerancia y candidato único de cada lado
  const ls = libresL();
  for (const l of ls) {
    const c = libresM().filter((m) => centavos(m) === centavos(l) && dias(l.fecha, m.fecha) <= toleranciaDias);
    if (c.length !== 1) continue;
    const inversas = ls.filter((x) => !usadasL.has(x.id) && centavos(x) === centavos(c[0]) && dias(x.fecha, c[0].fecha) <= toleranciaDias);
    if (inversas.length === 1) agregar([l], c, 'PROBABLE');
  }

  // 3. Agrupada: una línea contra varios movimientos de la misma fecha y signo, y al revés
  for (const l of libresL()) {
    const c = libresM().filter((m) => dias(m.fecha, l.fecha) === 0 && Math.sign(centavos(m)) === Math.sign(centavos(l)));
    const g = c.length >= 2 ? subconjunto(c, centavos(l)) : null;
    if (g) agregar([l], g, 'AGRUPADA');
  }
  for (const m of libresM()) {
    const c = libresL().filter((l) => dias(m.fecha, l.fecha) === 0 && Math.sign(centavos(m)) === Math.sign(centavos(l)));
    const g = c.length >= 2 ? subconjunto(c, centavos(m)) : null;
    if (g) agregar(g.sort((a, b) => lineas.indexOf(a) - lineas.indexOf(b)), [m], 'AGRUPADA');
  }
  return r;
}
