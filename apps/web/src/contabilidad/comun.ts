import { useQuery } from '@tanstack/react-query';
import { api } from '../api/cliente';
import { sesion } from '../auth/sesion';
import { ErrorApi } from '../api/cliente';

interface NodoCuenta { id: string; codigo: string; nombre: string; imputable: boolean; hijos: NodoCuenta[] }
export interface Ejercicio {
  id: string; numero: number; desde: string; hasta: string; estado: 'ABIERTO' | 'CERRADO';
  periodos: { id: string; anio: number; mes: number; estado: 'ABIERTO' | 'CERRADO'; asientos: number }[];
}

/** Todas las cuentas del plan (rubros incluidos), en orden, para el Mayor. */
export function useTodasLasCuentas() {
  const q = useQuery({ queryKey: ['/plan-cuentas', 'todas'], queryFn: () => api<NodoCuenta[]>('/plan-cuentas') });
  const plano: { value: string; label: string }[] = [];
  const recorrer = (ns: NodoCuenta[]) => ns.forEach((n) => { plano.push({ value: n.id, label: `${n.codigo} ${n.nombre}` }); recorrer(n.hijos); });
  recorrer(q.data ?? []);
  return plano;
}

export const useCentrosCosto = () =>
  (useQuery({ queryKey: ['/centros-costo', 'opciones'], queryFn: () => api<{ id: string; codigo: string; nombre: string }[]>('/centros-costo') }).data ?? [])
    .map((c) => ({ value: c.id, label: `${c.codigo} ${c.nombre}` }));

export const useEjercicios = () => useQuery({ queryKey: ['/contabilidad/ejercicios'], queryFn: () => api<Ejercicio[]>('/contabilidad/ejercicios') });

/** POST que devuelve un archivo: lo descarga y devuelve los encabezados de la respuesta. */
export async function descargarPost(ruta: string, body: unknown, nombre: string): Promise<Headers> {
  const token = sesion.leer()?.token;
  const res = await fetch(`/api${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ErrorApi(res.status, d.message ?? 'No se pudo generar el archivo');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return res.headers;
}
