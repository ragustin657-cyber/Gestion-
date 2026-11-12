export interface LineaGrilla { cuentaContableId: string; codigo: string; nombre: string; tipo: 'INGRESO' | 'EGRESO'; centroCostoId: string | null; centroCosto: string | null; importes: Record<string, string>; total: string }
export interface Grilla {
  presupuesto: { id: string; nombre: string; vigente: boolean; ejercicioId?: string };
  meses: string[];
  lineas: LineaGrilla[];
  totales: { porMes: Record<string, string>; ingresos: string; egresos: string; resultado: string };
}
export interface FilaComparacion { clave: string; nombre: string; tipo: 'INGRESO' | 'EGRESO' | 'RESULTADO'; presupuesto: string; real: string; desvio: string; desvioPct: string | null; favorable: boolean; sinPresupuesto: boolean }
type Total = { presupuesto: string; real: string; desvio: string; desvioPct: string | null };
export interface Comparacion {
  presupuesto: { id: string; nombre: string }; desde: string; hasta: string; agrupar: string;
  filas: FilaComparacion[]; totales: { ingresos: Total; egresos: Total; resultado: Total }; serie: { mes: string; presupuesto: string; real: string }[];
}
export interface PresupuestoLista { id: string; nombre: string; vigente: boolean; observaciones: string | null; ejercicioId: string; totalIngresos: string; totalEgresos: string }

export const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
export const pctTexto = (p: string | null) => (p === null ? '—' : `${Number(p).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);
