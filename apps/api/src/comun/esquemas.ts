import { z } from 'zod';
import { esPermiso, normalizarCuit, validarCuit } from '@gestion/shared';

export const zCuit = z
  .string({ required_error: 'Campo obligatorio' })
  .refine(validarCuit, 'CUIT inválido')
  .transform(normalizarCuit);

export const zPermisos = z.array(z.string()).refine((ps) => ps.every(esPermiso), 'Permiso inexistente');

export const zPassword = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres');

export const zTexto = z.string().trim().min(1);
export const zTextoOpcional = z.string().trim().optional().nullable();

/** Pulido E49: ids que llegan por query sin validar (un texto que no es UUID daría 500 en Postgres). */
export const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
