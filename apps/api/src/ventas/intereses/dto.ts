import { z } from 'zod';

export const esquemaConfigIntereses = z.object({
  tasaMensual: z.number().refine((n) => Number.isFinite(n) && n > 0 && n <= 100 && Number(n.toFixed(2)) === n, 'Tasa inválida'),
  descripcion: z.string().trim().min(1).max(100).optional(),
});
export type DatosConfigIntereses = z.infer<typeof esquemaConfigIntereses>;

export const esquemaLiquidarIntereses = z.object({ anio: z.number().int(), mes: z.number().int().min(1).max(12), excluir: z.array(z.string().uuid()).default([]) });
