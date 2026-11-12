import { z } from 'zod';

const uuid = z.string().uuid('Valor inválido');
export const esquemaPresupuesto = z.object({
  ejercicioId: uuid,
  nombre: z.string().trim().min(1, 'Requerido').max(100),
  observaciones: z.string().trim().max(500).nullish(),
  copiarDeId: uuid.nullish(),
});
export const esquemaModificacion = z.object({ nombre: z.string().trim().min(1, 'Requerido').max(100), observaciones: z.string().trim().max(500).nullish() });
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido');
export const esquemaLinea = z.object({
  cuentaContableId: uuid,
  centroCostoId: uuid.nullish(),
  importes: z.record(mes, z.number().min(0, 'No puede ser negativo')),
  /** true: solo cambian los meses enviados (0 borra ese mes); false: se reemplaza la línea entera. */
  parcial: z.boolean().optional(),
});
export type DatosPresupuesto = z.infer<typeof esquemaPresupuesto>;
export type DatosLinea = z.infer<typeof esquemaLinea>;
