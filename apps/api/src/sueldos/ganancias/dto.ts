import { z } from 'zod';

const importe = z.number().min(0).max(1e13);

/** Tabla de ARCA de un semestre (importes anuales) con la escala del art. 94 (spec E31 §3). */
export const esquemaTablaGanancias = z.object({
  gni: importe, deduccionEspecial: importe, conyuge: importe, hijo: importe, hijoIncapacitado: importe,
  topes: z.object({ hipotecario: importe, seguroMuerte: importe, seguroMixto: importe, seguroRetiro: importe, sepelio: importe }),
  tramos: z.array(z.object({ desde: importe, hasta: importe.nullable(), fijo: importe, porcentaje: z.number().min(0).max(100) })).min(1, 'Cargue la escala'),
}).superRefine((d, ctx) => {
  const t = d.tramos;
  const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['tramos'] });
  if (t[0].desde !== 0) return error('El primer tramo empieza en 0');
  for (let i = 0; i < t.length - 1; i++) if (t[i].hasta === null || t[i + 1].desde !== t[i].hasta || t[i].hasta! <= t[i].desde) return error('Los tramos deben ser consecutivos');
  if (t[t.length - 1].hasta !== null) return error('El último tramo no tiene límite');
});
export type DatosTablaGanancias = z.infer<typeof esquemaTablaGanancias>;
