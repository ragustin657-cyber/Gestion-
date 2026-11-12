import { z } from 'zod';
import { zFecha } from '../../compras/comun';
import { zAlicuota } from '../comprobantes/dto';

export const zRenglonPedido = z.object({
  articuloId: z.string().uuid('Valor inválido').nullish(),
  descripcion: z.string().trim().min(1, 'Campo obligatorio'),
  cantidad: z.number().gt(0, 'Debe ser mayor a cero'),
  precioUnitario: z.number().gt(0, 'Debe ser mayor a cero'),
  alicuota: zAlicuota,
});
export const esquemaPedido = z.object({
  terceroId: z.string().uuid('Valor inválido'),
  fecha: zFecha,
  validoHasta: zFecha.nullish(),
  monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }),
  cotizacion: z.number().positive().nullish(),
  listaPreciosId: z.string().uuid().nullish(),
  depositoId: z.string().uuid().nullish(),
  observaciones: z.string().trim().max(1000).nullish(),
  renglones: z.array(zRenglonPedido).min(1, 'El pedido debe tener al menos un renglón'),
  confirmar: z.boolean().default(false),
});
export type DatosPedido = z.infer<typeof esquemaPedido>;
export const esquemaModPedido = esquemaPedido.and(z.object({ version: z.number().int().min(0) }));
export const esquemaMotivo = z.object({ motivo: z.string().trim().min(1, 'Indique el motivo') });
