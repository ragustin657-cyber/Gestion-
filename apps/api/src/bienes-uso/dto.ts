import { z } from 'zod';

const uuid = z.string().uuid('Valor inválido');
export const esquemaRubro = z.object({
  nombre: z.string().trim().min(1, 'Requerido').max(100),
  cuentaOrigenId: uuid,
  cuentaAmortizacionId: uuid,
  cuentaGastoId: uuid,
  vidaUtilMeses: z.number().int('Debe ser un número entero').min(1, 'Debe ser al menos 1').max(1200, 'No puede superar 1200'),
  activo: z.boolean().optional(),
});
export type DatosRubro = z.infer<typeof esquemaRubro>;
