import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Mes 'AAAA-MM'. */
export type Mes = string;

export const mesDe = (f: Date): Mes => f.toISOString().slice(0, 7);

export function sumarMeses(m: Mes, n: number): Mes {
  const [a, mm] = m.split('-').map(Number);
  const t = a * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Meses de `desde` a `hasta`, ambos inclusive (0 si hasta < desde). */
export function mesesEntre(desde: Mes, hasta: Mes): number {
  const n = (m: Mes) => { const [a, mm] = m.split('-').map(Number); return a * 12 + mm; };
  return Math.max(0, n(hasta) - n(desde) + 1);
}

export interface DatosBien {
  fechaAlta: Date; valorOrigen: Dec; valorResidual: Dec; vidaUtilMeses: number;
  amortizacionInicial: Dec; fechaAmortizacionInicial: Date | null; fechaBaja: Date | null;
}

/** Último mes que se amortiza: fin de la vida útil o el anterior al de la baja. */
export function ultimoMesAmortizable(b: DatosBien): Mes {
  const finVida = sumarMeses(mesDe(b.fechaAlta), b.vidaUtilMeses - 1);
  if (!b.fechaBaja) return finVida;
  const antesBaja = sumarMeses(mesDe(b.fechaBaja), -1);
  return antesBaja < finVida ? antesBaja : finVida;
}

/** Amortización acumulada que el bien debería tener al cierre del mes `hasta` (spec §4). */
export function acumuladaEsperada(b: DatosBien, hasta: Mes): Dec {
  const amortizable = new D(b.valorOrigen).minus(b.valorResidual);
  const tope = ultimoMesAmortizable(b);
  const m = hasta < tope ? hasta : tope;
  const finVida = sumarMeses(mesDe(b.fechaAlta), b.vidaUtilMeses - 1);
  if (b.fechaAmortizacionInicial) {
    const mi = mesDe(b.fechaAmortizacionInicial);
    const inicial = new D(b.amortizacionInicial);
    if (m <= mi) return inicial;
    const restantes = mesesEntre(sumarMeses(mi, 1), finVida);
    if (restantes <= 0) return inicial;
    const meses = mesesEntre(sumarMeses(mi, 1), m);
    if (meses >= restantes) return amortizable;
    return D.min(amortizable, inicial.plus(amortizable.minus(inicial).times(meses).div(restantes)).toDecimalPlaces(2));
  }
  const meses = mesesEntre(mesDe(b.fechaAlta), m);
  if (meses >= b.vidaUtilMeses) return amortizable;
  return amortizable.times(meses).div(b.vidaUtilMeses).toDecimalPlaces(2);
}
