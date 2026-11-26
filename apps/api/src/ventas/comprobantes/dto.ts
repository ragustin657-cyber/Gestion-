import { z } from 'zod';
import { esAlicuotaIva } from '@gestion/shared';
import { zFecha } from '../../compras/comun';

export const zAlicuota = z.union([
  z.number().refine(esAlicuotaIva, 'Alícuota de IVA inválida'),
  z.enum(['NO_GRAVADO', 'EXENTO']),
]);

/** E51: hasta 2 decimales. */
const dosDecimales = (x: number) => Math.abs(Math.round(x * 100) - x * 100) < 1e-6;
export const zBonificacion = z.number().min(0, 'Entre 0 y 100').max(100, 'Entre 0 y 100').refine(dosDecimales, 'Hasta 2 decimales').optional();
export const zDescuento = z.number().min(0, 'Entre 0 y 100').lt(100, 'Debe ser menor que 100').refine(dosDecimales, 'Hasta 2 decimales').optional();

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
    vendedorId: z.string().uuid('Valor inválido').nullish(),
    aplicarAAsociado: z.boolean().default(true),
    depositoId: z.string().uuid('Valor inválido').nullish(),
    devuelveMercaderia: z.boolean().default(false),
    renglones: z
      .array(z.object({
        origen: z.enum(['DIRECTO', 'REMITO', 'PEDIDO', 'DEVOLUCION']).default('DIRECTO'),
        devolucionRenglonId: z.string().uuid('Valor inválido').nullish(),
        remitoRenglonId: z.string().uuid('Valor inválido').nullish(),
        pedidoRenglonId: z.string().uuid('Valor inválido').nullish(),
        articuloId: z.string().uuid('Valor inválido').nullish(),
        bienUsoId: z.string().uuid('Valor inválido').nullish(),
        descripcion: z.string().trim().min(1, 'Campo obligatorio'),
        cantidad: z.number().gt(0, 'Debe ser mayor a cero'),
        precioUnitario: z.number().gt(0, 'Debe ser mayor a cero'),
        alicuota: zAlicuota,
        bonificacionPct: zBonificacion,
      }))
      .min(1, 'El comprobante debe tener al menos un renglón'),
    emitir: z.boolean().default(false),
    descuentoPct: zDescuento,
    // E50: factura de crédito electrónica MiPyME
    fce: z.boolean().optional(),
    transferenciaFce: z.enum(['SCA', 'ADC'], { message: 'Valor inválido' }).nullish(),
    anulacionFce: z.boolean().nullish(),
    // E58: factura de exportación (letra E); sin indicar, se marca si el cliente es del exterior
    exportacion: z.boolean().optional(),
    tipoExportacion: z.enum(['BIENES', 'SERVICIOS', 'OTROS']).nullish(),
    paisDestino: z.number().int().min(1).max(999).nullish(),
    incoterm: z.enum(['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']).nullish(),
    incotermDescripcion: z.string().trim().max(100).nullish(),
    formaPago: z.string().trim().max(100).nullish(),
    idioma: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    permisoExistente: z.enum(['S', 'N']).nullish(),
    permisos: z.array(z.object({ numero: z.string().trim().length(16, 'El permiso de embarque tiene 16 caracteres'), paisDestino: z.number().int().min(1).max(999) })).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.concepto !== 'PRODUCTOS') {
      // En la FCE el vencimiento del pago es el del comprobante (E50)
      for (const campo of ['fechaServicioDesde', 'fechaServicioHasta', ...(c.fce ? [] : ['fechaVencimientoPago' as const])] as const)
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
