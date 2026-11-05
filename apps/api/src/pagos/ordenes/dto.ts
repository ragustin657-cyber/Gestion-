import { z } from 'zod';
import { zFecha, zMotivo, zVersion } from '../../compras/comun';

export const esquemaOP = z.object({
  terceroId: z.string().uuid(),
  fecha: zFecha,
  cotizacion: z.number().positive().nullish(),
  observaciones: z.string().trim().nullish(),
  imputaciones: z.array(z.object({ movimientoId: z.string().uuid(), importe: z.number().refine((n) => n !== 0, 'El importe no puede ser cero') })).default([]),
  anticipo: z.object({ monedaCodigo: z.enum(['ARS', 'USD']), importe: z.number().gt(0, 'Debe ser mayor a cero') }).nullish(),
});
export type DatosOP = z.infer<typeof esquemaOP>;
export const esquemaVersion = zVersion;
export const esquemaMotivo = zVersion.extend({ motivo: zMotivo });

export const esquemaPagar = zVersion.extend({
  fechaPago: zFecha,
  medios: z.array(z.object({
    tipo: z.enum(['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO']),
    monedaCodigo: z.enum(['ARS', 'USD']),
    importe: z.number().gt(0, 'Debe ser mayor a cero'),
    cuentaBancariaId: z.string().uuid().nullish(),
    cajaId: z.string().uuid().nullish(),
    chequeraId: z.string().uuid().nullish(),
    chequeNumero: z.string().trim().min(1).nullish(),
    chequeFechaPago: zFecha.nullish(),
    referencia: z.string().trim().nullish(),
  })).min(1, 'Indique al menos un medio de pago'),
});
export type DatosPagar = z.infer<typeof esquemaPagar>;
