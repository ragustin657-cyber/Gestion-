import type { Permiso } from '@gestion/shared';

export interface Sesion {
  token: string;
  usuario: { id: string; nombre: string };
  empresas?: { id: string; razonSocial: string }[];
  empresa?: { id: string; razonSocial: string; condicionIva?: string };
  permisos?: Permiso[];
  superadmin?: boolean;
  /** Sucursal asignada al usuario en la empresa (ausente = todas). */
  sucursal?: { id: string; codigo: string; nombre: string } | null;
}

const CLAVE = 'gestion.sesion';
export const EVENTO_SESION_CERRADA = 'gestion:sesion-cerrada';

function leer(): Sesion | null {
  try {
    const s = localStorage.getItem(CLAVE);
    return s ? (JSON.parse(s) as Sesion) : null;
  } catch {
    return null;
  }
}

export const sesion = {
  leer,
  guardar(s: Sesion) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(s));
    } catch {
      /* almacenamiento no disponible */
    }
  },
  cerrar() {
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* nada */
    }
    window.dispatchEvent(new Event(EVENTO_SESION_CERRADA));
  },
};
