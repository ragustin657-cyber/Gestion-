import { useState } from 'react';
import { hoy } from '../compras/formato';

export interface MesVentas { mes: string; ventas: string; costo: string; margen: string }
export interface FilaVentas { clave: string; nombre: string; ventas: string; costo: string; margen: string; margenPct: string | null; sinCosto: string }
export interface Totales { ventas: string; costo: string; margen: string; margenPct: string | null; sinCosto: string; cobertura: string | null }
export interface InformeVentas { filas: FilaVentas[]; totales: Totales; aviso?: string }
type Tramos = { aVencer: string; d1_30: string; d31_60: string; d61_90: string; mas90: string; aFavor: string; total: string };
export interface InformeAntiguedad { filas: (Tramos & { terceroId: string; nombre: string })[]; totales: Tramos }
type Rot = { stockInicial: string; stockFinal: string; costoVendido: string; rotacion: string | null; diasCobertura: string | null };
export interface InformeRotacion { filas: (Rot & { articuloId: string; codigo: string; descripcion: string })[]; totales: Rot }
export interface Tablero {
  aviso?: string;
  indicadores: {
    ventas: { valor: string; anterior: string; anioAnterior: string };
    margenPct: { valor: string | null; anterior: string | null; anioAnterior: string | null };
    cobranzasVencidas: { valor: string }; deudaVencida: { valor: string }; stock: { valor: string };
    presupuesto?: { nombre: string; resultadoPresupuestado: string; resultadoReal: string; desvioPct: string | null } | null;
  };
  ventasPorMes: MesVentas[];
  topClientes: { id: string; nombre: string; ventas: string }[];
  topArticulos: { id: string; codigo: string; descripcion: string; ventas: string; margen: string }[];
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** '2026-11' → 'nov 26'. */
export const mesCorto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Datos del gráfico del tablero. */
export const seriesVentas = (meses: MesVentas[]) => meses.map((m) => ({ mes: mesCorto(m.mes), ventas: Number(m.ventas), margen: Number(m.margen) }));

/** Primer y último día del mes 'AAAA-MM'. */
export function rangoMes(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

export const mesActual = () => hoy().slice(0, 7);

/** '12.34' → '12,34 %' (o '—'). */
export const pctTexto = (p: string | null | undefined) => (p === null || p === undefined ? '—' : `${Number(p).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

/** Orden por columna: clic en un encabezado alterna ascendente/descendente. */
export function useOrden<T>(filas: T[], inicial?: { campo: keyof T; desc: boolean }) {
  const [orden, setOrden] = useState(inicial);
  const ordenar = (campo: keyof T) => setOrden((o) => ({ campo, desc: o?.campo === campo ? !o.desc : true }));
  const valor = (x: unknown) => (x === null || x === undefined ? -Infinity : typeof x === 'string' && x !== '' && !Number.isNaN(Number(x)) ? Number(x) : x);
  const ordenadas = !orden ? filas : [...filas].sort((a, b) => {
    const va = valor(a[orden.campo]) as number | string, vb = valor(b[orden.campo]) as number | string;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return orden.desc ? -c : c;
  });
  return { ordenadas, ordenar, orden };
}
