import { ReactNode } from 'react';
import type { Permiso } from '@gestion/shared';

export interface Opcion {
  value: string;
  label: string;
  grupo?: string;
}

export interface CampoAbm {
  nombre: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'booleano' | 'select' | 'fecha' | 'multiselect' | 'checkboxes' | 'password';
  requerido?: boolean;
  opciones?: Opcion[];
  ayuda?: string;
  /** Validación en el cliente: devuelve el mensaje de error o null. */
  validar?: (valor: unknown) => string | null;
  /** Select cuyo valor se envía como número. */
  numerico?: boolean;
  /** Ocupa toda la fila. */
  ancho?: boolean;
}

export interface ColumnaAbm<T> {
  campo: keyof T & string;
  titulo: string;
  render?: (fila: T) => ReactNode;
}

export interface ConfigMaestro<T> {
  titulo: string;
  ruta: string;
  columnas: ColumnaAbm<T>[];
  campos: CampoAbm[];
  camposEdicion?: CampoAbm[];
  permisoEditar?: Permiso;
  paginado?: boolean;
  /** Sin modificación: solo alta. */
  soloAlta?: boolean;
  valoresNuevos?: Record<string, unknown>;
}
