import { z } from 'zod';
import { esAlicuotaIva } from '@gestion/shared';
import { zFecha } from '../../compras/comun';

const zAlicuota = z.union([
  z.number().refine(esAlicuotaIva, 'Alícuota de IVA inválida'),
  z.enum(['NO_GRAVADO', 'EXENTO']),
]);

export const esquemaComprobanteVenta = z
  .object({
    terceroId: z.string().uuid('Valor inválido'),
    puntoVentaId: z.string().uuid('Valor inválido'),
    tipo: z.enum(['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO']),
    concepto: z.enum(['PRODUCTOS', 'SERVICIOS', 'PRODUCTOS_Y_SERVICIOS']),
    fecha: zFecha,
    fechaVencimiento: zFecha,
    fechaServicioDesde: zFecha.nullish(),
    fechaServicioHasta: zFecha.nullish(),
    fechaVencimientoPago: zFecha.nullish(),
    monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }),
    cotizacion: z.number().positive('Debe ser mayor a cero').nullish(),
    comprobanteAsociadoId: z.string().uuid('Valor inválido').nullish(),
    aplicarAAsociado: z.boolean().default(true),
    depositoId: z.string().uuid('Valor inválido').nullish(),
    devuelveMercaderia: z.boolean().default(false),
    renglones: z
      .array(z.object({
        articuloId: z.string().uuid('Valor inválido').nullish(),
        descripcion: z.string().trim().min(1, 'Campo obligatorio'),
        cantidad: z.number().gt(0, 'Debe ser mayor a cero'),
        precioUnitario: z.number().gt(0, 'Debe ser mayor a cero'),
        alicuota: zAlicuota,
      }))
      .min(1, 'El comprobante debe tener al menos un renglón'),
    emitir: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.concepto !== 'PRODUCTOS') {
      for (const campo of ['fechaServicioDesde', 'fechaServicioHasta', 'fechaVencimientoPago'] as const)
        if (!c[campo]) ctx.addIssue({ code: 'custom', path: [campo], message: 'Campo obligatorio para servicios' });
      if (c.fechaServicioDesde && c.fechaServicioHasta && c.fechaServicioDesde > c.fechaServicioHasta)
        ctx.addIssue({ code: 'custom', path: ['fechaServicioHasta'], message: 'Debe ser posterior al inicio del período' });
    }
    if (c.tipo !== 'FACTURA' && !c.comprobanteAsociadoId)
      ctx.addIssue({ code: 'custom', path: ['comprobanteAsociadoId'], message: 'Indique el comprobante asociado' });
    if (c.fechaVencimiento < c.fecha) ctx.addIssue({ code: 'custom', path: ['fechaVencimiento'], message: 'No puede ser anterior a la fecha' });
  });

export type DatosComprobanteVenta = z.infer<typeof esquemaComprobanteVenta>;

export const esquemaModificacionVenta = esquemaComprobanteVenta.and(z.object({ version: z.number().int().min(0) }));
