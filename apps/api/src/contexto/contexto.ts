import type { Permiso } from '@gestion/shared';

export interface ContextoRequest {
  usuarioId: string;
  empresaId: string | null;
  permisos: Permiso[];
  superadmin: boolean;
}

export const CLAVE_CONTEXTO = 'contexto';
