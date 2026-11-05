import { SetMetadata } from '@nestjs/common';
import type { Permiso } from '@gestion/shared';

export const PERMISOS_REQUERIDOS = 'permisosRequeridos';
export const RequierePermiso = (...permisos: Permiso[]) => SetMetadata(PERMISOS_REQUERIDOS, permisos);

export const SOLO_SUPERADMIN = 'soloSuperadmin';
export const SoloSuperadmin = () => SetMetadata(SOLO_SUPERADMIN, true);
