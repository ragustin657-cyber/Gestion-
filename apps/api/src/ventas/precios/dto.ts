import { z } from 'zod';
import { zTexto } from '../../comun/esquemas';
import { REDONDEOS } from './aumento';

export const esquemaLista = z.object({
  nombre: zTexto, monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }), activa: z.boolean().default(true), porDefecto: z.boolean().default(false),
});
export const esquemaModLista = z.object({ nombre: zTexto.optional(), monedaCodigo: z.enum(['ARS', 'USD']).optional(), activa: z.boolean().optional(), porDefecto: z.boolean().optional() });
export const esquemaPrecio = z.object({ precio: z.number().positive('El precio debe ser mayor que cero') });
export const esquemaAumento = z.object({
  porcentaje: z.number().min(-90).max(1000).refine((x) => x !== 0, 'Indique un porcentaje distinto de cero'),
  articuloIds: z.array(z.string().uuid()).optional(),
  redondeo: z.enum(REDONDEOS),
});
