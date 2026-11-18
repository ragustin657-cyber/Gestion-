import { z } from 'zod';

// La fecha tiene que existir (el 30/02 no se corre al mes siguiente): debe volver igual al formatearla
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Fecha inválida');
// Importe con dos decimales como máximo y dentro de DECIMAL(18,2)
const zImporte = z.number().refine((n) => Number.isFinite(n) && Math.abs(n) <= 999999999999.99 && Number(n.toFixed(2)) === n, 'Importe inválido');
export const esquemaGestion = z.object({
  fecha: zFecha.nullish(),
  medio: z.enum(['LLAMADO', 'MAIL', 'WHATSAPP', 'VISITA', 'OTRO']),
  nota: z.string().max(1000),
  proximaAccion: zFecha.nullish(),
  promesaFecha: zFecha.nullish(),
  promesaImporte: zImporte.nullish(),
});
export type DatosGestion = z.infer<typeof esquemaGestion>;
