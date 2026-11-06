import type { Permiso } from '@gestion/shared';

export interface ContextoRequest {
  usuarioId: string;
  empresaId: string | null;
  permisos: Permiso[];
  superadmin: boolean;
  /** Sucursal asignada al usuario en la empresa activa; null = todas. */
  sucursalId: string | null;
}

export const CLAVE_CONTEXTO = 'contexto';
