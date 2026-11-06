import { sesion } from '../auth/sesion';

export class ErrorApi extends Error {
  constructor(
    public status: number,
    public mensaje: string,
    public campos?: Record<string, string>,
    /** Cuerpo completo de la respuesta de error (por ejemplo, diferencias del control de 3 vías). */
    public datos?: Record<string, unknown>,
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
  throw new ErrorApi(res.status, mensaje, datos?.campos, datos);
}

/** Descarga un archivo (PDF, Excel) de la API con el token de la sesión. */
export async function descargar(ruta: string, query: OpcionesApi['query'], nombreArchivo: string): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const token = sesion.leer()?.token;
  const res = await fetch(`/api${ruta}${params.size ? `?${params}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const datos = await res.json().catch(() => ({}));
    throw new ErrorApi(res.status, datos.message ?? 'No se pudo descargar el archivo');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sube un archivo (multipart) con campos adicionales. */
export async function subirArchivo<T>(ruta: string, campos: Record<string, string>, archivo: File, nombreCampo = 'archivo'): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  fd.append(nombreCampo, archivo);
  const token = sesion.leer()?.token;
  const res = await fetch(`/api${ruta}`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorApi(res.status, datos.message ?? 'No se pudo subir el archivo', datos.campos, datos);
  return datos as T;
}

/** Sube varios archivos (multipart), uno por campo. */
export async function subirArchivos<T>(ruta: string, archivos: Record<string, File>): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(archivos)) fd.append(k, v);
  const token = sesion.leer()?.token;
  const res = await fetch(`/api${ruta}`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorApi(res.status, datos.message ?? 'No se pudo subir el archivo', datos.campos, datos);
  return datos as T;
}
