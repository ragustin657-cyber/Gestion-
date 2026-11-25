import { z } from 'zod';
import { zFecha } from '../../compras/comun';

const zIds = z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.string().uuid('Valor inválido')).optional());

export const esquemaVistaPrevia = z.object({ hasta: zFecha, fecha: zFecha, terceroIds: zIds });
export type FiltroVistaPrevia = z.infer<typeof esquemaVistaPrevia>;

export const esquemaGenerar = z.object({
  hasta: zFecha, fecha: zFecha, puntoVentaId: z.string().uuid('Valor inválido'),
  grupos: z.array(z.object({ terceroId: z.string().uuid('Valor inválido'), monedaCodigo: z.enum(['ARS', 'USD']) })).min(1, 'Elija al menos un cliente'),
});
export type DatosGenerar = z.infer<typeof esquemaGenerar>;
