import { z } from 'zod';

const importe = z.number().refine((n) => n !== 0 && Number.isFinite(n), 'Importe inválido');
const tramo = z.object({ anio: z.number().int().min(1900).max(2999), mes: z.number().int().min(1).max(12), importe });

export const esquemaConfig = z.object({
  primerEjercicioId: z.string().uuid('Ejercicio inválido'),
  asientoAperturaId: z.string().uuid().nullish(),
  anticuacion: z.array(z.object({ cuentaContableId: z.string().uuid(), tramos: z.array(tramo) })).default([]),
});
export type DatosConfig = z.infer<typeof esquemaConfig>;
