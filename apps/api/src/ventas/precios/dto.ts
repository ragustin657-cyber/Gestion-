import { z } from 'zod';
import { zTexto } from '../../comun/esquemas';
import { REDONDEOS } from './aumento';

/** E52: regla de la lista (base, lista base, porcentaje y redondeo). */
const regla = {
  base: z.enum(['MANUAL', 'LISTA', 'COSTO']).optional(), listaBaseId: z.string().uuid('Valor inválido').nullish(),
  porcentaje: z.number().min(-99.99, 'Porcentaje inválido').max(1000, 'Porcentaje inválido').optional(), redondeo: z.enum(REDONDEOS).optional(),
};
export const esquemaLista = z.object({
  nombre: zTexto, monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }), activa: z.boolean().default(true), porDefecto: z.boolean().default(false), ...regla,
});
export const esquemaModLista = z.object({ nombre: zTexto.optional(), monedaCodigo: z.enum(['ARS', 'USD']).optional(), activa: z.boolean().optional(), porDefecto: z.boolean().optional(), ...regla });
export type ReglaLista = { base?: 'MANUAL' | 'LISTA' | 'COSTO'; listaBaseId?: string | null; porcentaje?: number; redondeo?: (typeof REDONDEOS)[number] };
/** E52: marcas de un precio (fijo y margen propio). */
export const esquemaMarcas = z.object({ fijo: z.boolean().optional(), margenPct: z.number().min(0, 'Entre 0 y 1000').max(1000, 'Entre 0 y 1000').nullish() });
export const esquemaPrecio = z.object({ precio: z.number().positive('El precio debe ser mayor que cero') });
export const esquemaAumento = z.object({
  porcentaje: z.number().min(-90).max(1000).refine((x) => x !== 0, 'Indique un porcentaje distinto de cero'),
  articuloIds: z.array(z.string().uuid()).optional(),
  redondeo: z.enum(REDONDEOS),
});
