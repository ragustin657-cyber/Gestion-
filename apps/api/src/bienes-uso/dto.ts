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

const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').transform((s) => new Date(`${s}T00:00:00Z`));
const zImporte = z.number().min(0, 'No puede ser negativo');
const zVida = z.number().int('Debe ser un número entero').min(1, 'Debe ser al menos 1').max(1200, 'No puede superar 1200');

/** Datos del bien en un renglón de factura de proveedor. */
export const esquemaBienRenglon = z.object({
  descripcion: z.string().trim().min(1, 'Requerido').max(200),
  vidaUtilMeses: zVida.optional(),
  valorResidual: zImporte.optional(),
});
export type DatosBienRenglon = z.infer<typeof esquemaBienRenglon>;

export const esquemaBien = z.object({
  origen: z.enum(['MANUAL', 'INICIAL']),
  descripcion: z.string().trim().min(1, 'Requerido').max(200),
  rubroId: uuid,
  fechaAlta: zFecha,
  valorOrigen: z.number().positive('Debe ser mayor que cero'),
  vidaUtilMeses: zVida.optional(),
  valorResidual: zImporte.optional(),
  cuentaContrapartidaId: uuid.optional(),
  amortizacionInicial: zImporte.optional(),
  fechaAmortizacionInicial: zFecha.optional(),
});
export type DatosBien = z.infer<typeof esquemaBien>;

export const esquemaEdicionBien = z.object({
  descripcion: z.string().trim().min(1, 'Requerido').max(200).optional(),
  rubroId: uuid.optional(),
  fechaAlta: zFecha.optional(),
  valorOrigen: z.number().positive('Debe ser mayor que cero').optional(),
  vidaUtilMeses: zVida.optional(),
  valorResidual: zImporte.optional(),
});
export type EdicionBien = z.infer<typeof esquemaEdicionBien>;

export const esquemaBaja = z.object({ fecha: zFecha, motivo: z.enum(['DESUSO', 'SINIESTRO', 'ROBO'], { message: 'Motivo inválido' }) });
export type DatosBaja = z.infer<typeof esquemaBaja>;
