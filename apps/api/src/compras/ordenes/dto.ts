import { z } from 'zod';
import { zFecha, zMotivo, zRenglonBase, zVersion } from '../comun';

export const esquemaOC = z.object({
  terceroId: z.string().uuid(),
  fecha: zFecha,
  fechaEntrega: zFecha.nullish(),
  depositoId: z.string().uuid().nullish(),
  monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }),
  diasPago: z.number().int().min(0).max(365).nullish(),
  observaciones: z.string().trim().nullish(),
  renglones: z.array(zRenglonBase).min(1, 'La orden debe tener al menos un renglón'),
});
export type DatosOC = z.infer<typeof esquemaOC>;

export const esquemaVersion = zVersion;
export const esquemaMotivo = zVersion.extend({ motivo: zMotivo });
export const esquemaCerrar = zVersion.extend({ motivo: z.string().trim().nullish() });
