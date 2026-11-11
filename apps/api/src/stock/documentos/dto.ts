import { z } from 'zod';
import { zFecha } from '../../compras/comun';

const cantidad = z.number().positive('La cantidad debe ser mayor que cero');
const base = { fecha: zFecha, depositoId: z.string().uuid('Indique el depósito'), observaciones: z.string().trim().max(500).nullish() };

export const esquemaDocumento = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('TRANSFERENCIA'), ...base, depositoDestinoId: z.string().uuid('Indique el depósito de destino'), renglones: z.array(z.object({ articuloId: z.string().uuid(), cantidad })).min(1) }),
  z.object({ tipo: z.literal('INVENTARIO'), ...base, renglones: z.array(z.object({ articuloId: z.string().uuid(), cantidadContada: z.number().min(0) })).min(1) }),
  z.object({
    tipo: z.literal('INICIAL'), ...base, conAsiento: z.boolean().default(true), cuentaContableId: z.string().uuid().nullish(),
    renglones: z.array(z.object({ articuloId: z.string().uuid(), cantidad, costoUnitario: z.number().min(0) })).min(1),
  }),
  z.object({ tipo: z.literal('SALIDA'), ...base, cuentaContableId: z.string().uuid().nullish(), renglones: z.array(z.object({ articuloId: z.string().uuid(), cantidad })).min(1) }),
]);
export type DatosDocumento = z.infer<typeof esquemaDocumento>;
export const esquemaAnulacion = z.object({ motivo: z.string().trim().min(1, 'Indique el motivo') });
