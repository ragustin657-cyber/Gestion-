import { z } from 'zod';
import { zFecha, zMotivo, zVersion } from '../../compras/comun';

export const esquemaOP = z.object({
  terceroId: z.string().uuid(),
  fecha: zFecha,
  cotizacion: z.number().positive().nullish(),
  observaciones: z.string().trim().nullish(),
  imputaciones: z.array(z.object({ movimientoId: z.string().uuid(), importe: z.number().refine((n) => n !== 0, 'El importe no puede ser cero') })).default([]),
  anticipo: z.object({ monedaCodigo: z.enum(['ARS', 'USD']), importe: z.number().gt(0, 'Debe ser mayor a cero') }).nullish(),
});
export type DatosOP = z.infer<typeof esquemaOP>;
export const esquemaVersion = zVersion;
export const esquemaMotivo = zVersion.extend({ motivo: zMotivo });
