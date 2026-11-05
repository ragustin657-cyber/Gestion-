import { z } from 'zod';
import { normalizarNumeroComprobante } from '@gestion/shared';
import { zFecha, zMotivo } from '../comun';

export const esquemaIR = z.object({
  terceroId: z.string().uuid(),
  fecha: zFecha,
  depositoId: z.string().uuid().nullish(),
  remitoNumero: z
    .string({ required_error: 'Campo obligatorio' })
    .refine((s) => normalizarNumeroComprobante(s) !== null, 'Número de remito inválido (ej. 0001-00001234)')
    .transform((s) => normalizarNumeroComprobante(s)!),
  observaciones: z.string().trim().nullish(),
  renglones: z
    .array(z.object({ ordenCompraRenglonId: z.string().uuid(), cantidad: z.number().gt(0, 'Debe ser mayor a cero') }))
    .min(1, 'La recepción debe tener al menos un renglón'),
});
export type DatosIR = z.infer<typeof esquemaIR>;
export const esquemaAnular = z.object({ motivo: zMotivo });
