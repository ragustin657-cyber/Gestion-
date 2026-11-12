import { z } from 'zod';
import { zFecha } from '../../compras/comun';

export const esquemaRemito = z.object({
  terceroId: z.string().uuid('Valor inválido'),
  puntoVentaId: z.string().uuid('Indique el punto de venta'),
  fecha: zFecha,
  depositoId: z.string().uuid().nullish(),
  observaciones: z.string().trim().max(1000).nullish(),
  renglones: z.array(z.object({
    pedidoRenglonId: z.string().uuid().nullish(),
    articuloId: z.string().uuid().nullish(),
    descripcion: z.string().trim().min(1).nullish(),
    cantidad: z.number().gt(0, 'Debe ser mayor a cero'),
  })).min(1, 'El remito debe tener al menos un renglón'),
}).superRefine((d, ctx) => d.renglones.forEach((r, i) => {
  if (!r.pedidoRenglonId && !r.descripcion) ctx.addIssue({ code: 'custom', path: ['renglones', i, 'descripcion'], message: 'Campo obligatorio' });
}));
export type DatosRemito = z.infer<typeof esquemaRemito>;
export const esquemaAnulacionRemito = z.object({ motivo: z.string().trim().min(1, 'Indique el motivo') });
