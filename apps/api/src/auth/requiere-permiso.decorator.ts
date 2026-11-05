import { SetMetadata } from '@nestjs/common';
import type { Permiso } from '@gestion/shared';

export const PERMISOS_REQUERIDOS = 'permisosRequeridos';
export const RequierePermiso = (...permisos: Permiso[]) => SetMetadata(PERMISOS_REQUERIDOS, permisos);

export const PERMISOS_ALGUNO = 'permisosAlguno';
/** Requiere al menos uno de los permisos indicados. */
export const RequiereAlguno = (...permisos: Permiso[]) => SetMetadata(PERMISOS_ALGUNO, permisos);

export const SOLO_SUPERADMIN = 'soloSuperadmin';
export const SoloSuperadmin = () => SetMetadata(SOLO_SUPERADMIN, true);
