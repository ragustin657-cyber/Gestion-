import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';

export interface FilaExistencia {
  articuloId: string; codigo: string; descripcion: string; unidad: string;
  depositos: { depositoId: string; nombre: string; cantidad: string }[]; cantidad: string; costoPromedio: string; valor: string;
}
export interface Existencias { filas: FilaExistencia[]; total: string }

export const useDepositos = () =>
  useQuery({ queryKey: ['/depositos', 'stock'], queryFn: () => api<{ id: string; codigo: string; nombre: string }[]>('/depositos') });

/** Artículos que controlan stock, con sus saldos (la consulta de existencias). */
export const useExistencias = (query: Record<string, string | undefined> = {}) =>
  useQuery({ queryKey: ['/stock/existencias', query], queryFn: () => api<Existencias>('/stock/existencias', { query }) });

export const NOMBRE_DOCUMENTO: Record<string, string> = { TRANSFERENCIA: 'Transferencia', INVENTARIO: 'Inventario físico', INICIAL: 'Inventario inicial', SALIDA: 'Salida manual' };
export const NOMBRE_MOVIMIENTO: Record<string, string> = {
  RECEPCION: 'Recepción', COMPRA: 'Compra', AJUSTE_COSTO: 'Ajuste de costo', VENTA: 'Venta', DEVOLUCION_VENTA: 'Devolución de venta',
  TRANSFERENCIA: 'Transferencia', INVENTARIO: 'Inventario', INICIAL: 'Inicial', SALIDA_MANUAL: 'Salida manual', REGULARIZACION: 'Regularización',
};
export const cantidadTexto = (s: string | null | undefined) => (s === null || s === undefined ? '' : Number(s).toLocaleString('es-AR', { maximumFractionDigits: 4 }));
