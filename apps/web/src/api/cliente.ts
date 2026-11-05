import { sesion } from '../auth/sesion';

export class ErrorApi extends Error {
  constructor(
    public status: number,
    public mensaje: string,
    public campos?: Record<string, string>,
  ) {
    super(mensaje);
  }
}

export interface OpcionesApi {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/** Llama a la API con el token de la sesión. Ante 401 cierra la sesión. */
export async function api<T>(ruta: string, opciones: OpcionesApi = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opciones.query ?? {}))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const url = `/api${ruta}${params.size ? `?${params}` : ''}`;
  const token = sesion.leer()?.token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opciones.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: opciones.metodo ?? 'GET',
      headers,
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor');
  }

  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : undefined;
  if (res.ok) return datos as T;
  if (res.status === 401 && token) sesion.cerrar();
  const mensaje = Array.isArray(datos?.message) ? datos.message.join(', ') : (datos?.message ?? 'Error inesperado');
  throw new ErrorApi(res.status, mensaje, datos?.campos);
}
