import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { Opcion } from './tipos';

/** Carga opciones para un select desde la API. */
export function useOpciones<T>(ruta: string, mapear: (x: T) => Opcion): Opcion[] {
  const { data } = useQuery({ queryKey: [ruta, 'opciones'], queryFn: () => api<T[]>(ruta) });
  return (data ?? []).map(mapear);
}

export interface CuentaImputable { id: string; codigo: string; nombre: string }
export const useCuentasImputables = () =>
  useOpciones<CuentaImputable>('/plan-cuentas/imputables', (c) => ({ value: c.id, label: `${c.codigo} ${c.nombre}` }));

export const MONEDAS: Opcion[] = [
  { value: 'ARS', label: 'ARS - Peso argentino' },
  { value: 'USD', label: 'USD - Dólar' },
];
