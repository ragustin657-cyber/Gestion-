import { z } from 'zod';

export const esquemaVendedor = z.object({
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(['EMPLEADO', 'EXTERNO']),
  porcentaje: z.number().min(0, 'El porcentaje debe estar entre 0 y 100').max(100, 'El porcentaje debe estar entre 0 y 100'),
  empleadoId: z.string().uuid().nullish(),
  proveedorId: z.string().uuid().nullish(),
  activo: z.boolean().optional(),
});
export type DatosVendedor = z.infer<typeof esquemaVendedor>;
