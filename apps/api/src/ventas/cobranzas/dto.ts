import { z } from 'zod';

const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
export const esquemaGestion = z.object({
  fecha: zFecha.nullish(),
  medio: z.enum(['LLAMADO', 'MAIL', 'WHATSAPP', 'VISITA', 'OTRO']),
  nota: z.string().max(1000),
  proximaAccion: zFecha.nullish(),
  promesaFecha: zFecha.nullish(),
  promesaImporte: z.number().nullish(),
});
export type DatosGestion = z.infer<typeof esquemaGestion>;
