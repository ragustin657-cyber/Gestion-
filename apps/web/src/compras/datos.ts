import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { ArticuloGrilla } from './GrillaRenglones';

export interface Proveedor { id: string; razonSocial: string; cuit: string; condicionIva: string; diasPago: number }

/** Maestros que usan las pantallas de compras. */
export function useMaestrosCompras() {
  const proveedores = useQuery({
    queryKey: ['/terceros', 'proveedores-compras'],
    queryFn: () => api<{ items: Proveedor[] }>('/terceros', { query: { tipo: 'proveedor', activo: 'true', porPagina: 200 } }),
  });
  const articulos = useQuery({
    queryKey: ['/articulos', 'compras'],
    queryFn: () => api<{ items: ArticuloGrilla[] }>('/articulos', { query: { activo: 'true', porPagina: 200 } }),
  });
  const centros = useQuery({ queryKey: ['/centros-costo', 'compras'], queryFn: () => api<{ id: string; codigo: string; nombre: string; activo: boolean }[]>('/centros-costo') });
  const depositos = useQuery({ queryKey: ['/depositos', 'compras'], queryFn: () => api<{ id: string; codigo: string; nombre: string }[]>('/depositos') });
  return {
    proveedores: proveedores.data?.items ?? [],
    opcionesProveedor: (proveedores.data?.items ?? []).map((p) => ({ value: p.id, label: p.razonSocial })),
    articulos: articulos.data?.items ?? [],
    centros: (centros.data ?? []).filter((c) => c.activo),
    depositos: (depositos.data ?? []).map((d) => ({ value: d.id, label: `${d.codigo} - ${d.nombre}` })),
  };
}
