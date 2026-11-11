import type { CuentaContable } from '@prisma/client';
import type { RenglonAsiento } from '../asientos/asientos.service';
import { D, Dec } from '../consultas/saldos';
import { claveMes, Mes } from '../../indices-inflacion/indices';

export interface CuentaAjuste {
  cuentaContableId: string; codigo: string; nombre: string;
  saldoContable: string; reexpresado: string; ajuste: string; cuentaAjuste: string | null;
}

export interface Tramo { mes: Mes; importe: Dec }

/** Datos ya leídos de la base para calcular el ajuste (spec §5). */
export interface DatosCalculo {
  B: Mes;
  M: Mes;
  cuentas: CuentaContable[];
  recpamId: string;
  /** Cuenta de Resultados no asignados (absorbe la reexpresión de la apertura en el primer ejercicio). */
  rnaId: string;
  /** Saldo de apertura por cuenta. */
  apertura: Map<string, Dec>;
  /** Tramos de anticuación por cuenta; null si el ejercicio no es el primero ajustado. */
  anticuacion: Map<string, Tramo[]> | null;
  /** Movimientos del ejercicio hasta la fecha (sin apertura, cierre, refundición ni ajustes), por cuenta y mes. */
  movimientos: { cuentaId: string; mes: Mes; saldo: Dec }[];
  /** Saldo de los asientos de ajuste anteriores por cuenta. */
  ajustesPrevios: Map<string, Dec>;
  indices: Map<string, Dec>;
}

export interface Calculo { cuentas: CuentaAjuste[]; renglones: RenglonAsiento[]; recpam: Dec; avisos: string[] }

const cero = new D(0);
const suma = (xs: Dec[]) => xs.reduce((s, x) => s.plus(x), cero);

/** Meses cuyos índices necesita el cálculo. */
export function mesesNecesarios(d: Pick<DatosCalculo, 'B' | 'M' | 'anticuacion' | 'movimientos'>): Mes[] {
  return [d.B, d.M, ...d.movimientos.map((m) => m.mes), ...[...(d.anticuacion?.values() ?? [])].flat().map((t) => t.mes)];
}

/** Reexpresión por método directo; los renglones del RECPAM quedan incluidos. */
export function calcular(d: DatosCalculo): Calculo {
  const I = (m: Mes) => d.indices.get(claveMes(m))!;
  const porId = new Map(d.cuentas.map((c) => [c.id, c]));
  const esAjusteDe = new Set(d.cuentas.filter((c) => c.cuentaAjusteId).map((c) => c.cuentaAjusteId!));
  const grupos = d.cuentas
    .filter((c) => !c.monetaria && !esAjusteDe.has(c.id) && c.id !== d.recpamId)
    .map((c) => ({ principal: c, miembros: [c, ...(c.cuentaAjusteId ? [porId.get(c.cuentaAjusteId)!] : [])] }));
  const avisos: string[] = [];

  // Paso A: apertura reexpresada al mes B
  const aperturaA = new Map<string, Dec>();
  const ap = (id: string) => d.apertura.get(id) ?? cero;
  for (const g of grupos) for (const m of g.miembros) {
    if (!d.anticuacion || m.id === d.rnaId) { aperturaA.set(m.id, ap(m.id)); continue; }
    const tramos = d.anticuacion.get(m.id) ?? [];
    const resto = ap(m.id).minus(suma(tramos.map((t) => t.importe)));
    if (!resto.isZero()) avisos.push(`${m.codigo}: ${resto.toFixed(2)} sin anticuar, se toma al inicio del ejercicio`);
    aperturaA.set(m.id, suma(tramos.map((t) => t.importe.times(I(d.B)).div(I(t.mes)))).plus(resto));
  }
  if (d.anticuacion) {
    const diferencias = suma([...aperturaA].filter(([id]) => id !== d.rnaId).map(([id, v]) => v.minus(ap(id))));
    aperturaA.set(d.rnaId, ap(d.rnaId).minus(diferencias));
  }

  // Paso B: reexpresado al mes M, y ajuste contra el saldo contable
  const movs = new Map<string, { mes: Mes; saldo: Dec }[]>();
  for (const m of d.movimientos) movs.set(m.cuentaId, [...(movs.get(m.cuentaId) ?? []), m]);
  const cuentas: CuentaAjuste[] = [];
  const renglones: (RenglonAsiento & { codigo: string })[] = [];
  let total = cero;
  for (const g of grupos) {
    const ids = g.miembros.map((m) => m.id);
    const tieneDatos = ids.some((id) => d.apertura.has(id) || movs.has(id) || d.ajustesPrevios.has(id) || (aperturaA.get(id) && !aperturaA.get(id)!.isZero()));
    if (!tieneDatos) continue;
    const reexpresado = suma(ids.map((id) => (aperturaA.get(id) ?? cero).times(I(d.M)).div(I(d.B))
      .plus(suma((movs.get(id) ?? []).map((x) => x.saldo.times(I(d.M)).div(I(x.mes))))))).toDecimalPlaces(2);
    const contable = suma(ids.map((id) => ap(id).plus(suma((movs.get(id) ?? []).map((x) => x.saldo))).plus(d.ajustesPrevios.get(id) ?? cero)));
    const ajuste = reexpresado.minus(contable);
    const destino = g.miembros[g.miembros.length - 1];
    cuentas.push({
      cuentaContableId: g.principal.id, codigo: g.principal.codigo, nombre: g.principal.nombre,
      saldoContable: contable.toFixed(2), reexpresado: reexpresado.toFixed(2), ajuste: ajuste.toFixed(2),
      cuentaAjuste: g.miembros.length > 1 ? destino.codigo : null,
    });
    if (!ajuste.isZero()) {
      renglones.push({ codigo: destino.codigo, cuentaContableId: destino.id, ...(ajuste.gt(0) ? { debe: ajuste.toFixed(2) } : { haber: ajuste.neg().toFixed(2) }) });
      total = total.plus(ajuste);
    }
  }
  if (renglones.length && !total.isZero()) {
    const recpam = porId.get(d.recpamId)!;
    renglones.push({ codigo: recpam.codigo, cuentaContableId: recpam.id, ...(total.gt(0) ? { haber: total.toFixed(2) } : { debe: total.neg().toFixed(2) }) });
  }
  const orden = (a: { codigo: string }, b: { codigo: string }) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
  cuentas.sort(orden);
  renglones.sort(orden);
  return { cuentas, renglones: renglones.map(({ codigo: _c, ...r }) => r), recpam: total, avisos };
}
