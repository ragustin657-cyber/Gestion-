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
