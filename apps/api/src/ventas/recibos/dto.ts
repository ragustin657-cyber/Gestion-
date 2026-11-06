import { z } from 'zod';
import { zFecha } from '../../compras/comun';
import { esquemaIngreso } from '../../tesoreria/operaciones/dto';

const zImporte = z.number({ required_error: 'Campo obligatorio' }).gt(0, 'Debe ser mayor a cero').finite();

export const esquemaRecibo = z
  .object({
    terceroId: z.string().uuid('Valor inválido'),
    fecha: zFecha,
    puntoVentaId: z.string().uuid('Valor inválido'),
    cajaId: z.string().uuid('Valor inválido'),
    efectivo: esquemaIngreso.shape.efectivo,
    cheques: esquemaIngreso.shape.cheques,
    transferencias: esquemaIngreso.shape.transferencias,
    retenciones: z.array(z.object({
      tipo: z.enum(['IVA', 'GANANCIAS', 'IIBB', 'SUSS']),
      jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida').nullish(),
      numeroCertificado: z.string().trim().min(1, 'Campo obligatorio'),
      fecha: zFecha,
      importe: zImporte,
    })).default([]),
    aplicaciones: z.array(z.object({ comprobanteId: z.string().uuid('Valor inválido'), importe: zImporte })).default([]),
  })
  .superRefine((r, ctx) => {
    r.retenciones.forEach((x, i) => {
      if (x.tipo === 'IIBB' && !x.jurisdiccion) ctx.addIssue({ code: 'custom', path: ['retenciones', i, 'jurisdiccion'], message: 'Indique la jurisdicción' });
    });
  });

export type DatosRecibo = z.infer<typeof esquemaRecibo>;
