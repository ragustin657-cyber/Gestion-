import { z } from 'zod';
import { esquemaBienRenglon } from '../../bienes-uso/dto';
import { zFecha, zMotivo, zRenglonBase } from '../comun';

const zImporte = z.number().min(0, 'No puede ser negativo').default(0);

export const esquemaComprobante = z
  .object({
    terceroId: z.string().uuid(),
    tipo: z.enum(['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET']),
    letra: z.enum(['A', 'B', 'C', 'M']).nullish(),
    puntoVenta: z.number().int().min(1).max(99999),
    numero: z.number().int().min(1).max(99999999),
    fechaEmision: zFecha,
    fechaContable: zFecha,
    fechaVencimiento: zFecha.nullish(),
    monedaCodigo: z.enum(['ARS', 'USD'], { message: 'Moneda inválida' }),
    cotizacion: z.number().positive().nullish(),
    totalDeclarado: z.number({ required_error: 'Ingrese el total del comprobante' }).min(0),
    comprobanteAsociadoId: z.string().uuid().nullish(),
    depositoId: z.string().uuid('Valor inválido').nullish(),
    percepcionIva: zImporte,
    // Destino del crédito de IVA (E40)
    destinoCreditoIva: z.enum(['GRAVADO', 'EXENTO', 'COMUN']).optional(),
    impuestosInternos: zImporte,
    noGravado: zImporte,
    exento: zImporte,
    percepcionesIibb: z.array(z.object({ jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'), importe: z.number().gt(0) })).default([]),
    aceptoDiferencias: z.boolean().default(false),
    renglones: z
      .array(
        zRenglonBase.extend({
          origen: z.enum(['RECEPCION', 'ORDEN_COMPRA', 'DIRECTO']),
          informeRecepcionRenglonId: z.string().uuid().nullish(),
          ordenCompraRenglonId: z.string().uuid().nullish(),
          cuentaContableId: z.string().uuid().nullish(),
          bien: esquemaBienRenglon.nullish(),
        }),
      )
      .min(1, 'El comprobante debe tener al menos un renglón'),
  })
  .superRefine((c, ctx) => {
    if (c.tipo !== 'TICKET' && !c.letra) ctx.addIssue({ code: 'custom', path: ['letra'], message: 'Indique la letra del comprobante' });
    c.renglones.forEach((r, i) => {
      if (r.origen === 'RECEPCION' && !r.informeRecepcionRenglonId)
        ctx.addIssue({ code: 'custom', path: ['renglones', i, 'informeRecepcionRenglonId'], message: 'Falta el renglón de recepción' });
      if (r.origen === 'ORDEN_COMPRA' && !r.ordenCompraRenglonId)
        ctx.addIssue({ code: 'custom', path: ['renglones', i, 'ordenCompraRenglonId'], message: 'Falta el renglón de la orden de compra' });
    });
  });
export type DatosComprobante = z.infer<typeof esquemaComprobante>;
export const esquemaAnular = z.object({ motivo: zMotivo });

/** Despacho de importación (E41): en pesos, sin letra ni número de comprobante. */
export const esquemaDespacho = z.object({
  numeroDespacho: z.string().trim().toUpperCase().regex(/^\d{5}[A-Z]{2}\d{2}\d{6}[A-Z]$/, 'El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)'),
  fechaEmision: zFecha, fechaContable: zFecha.nullish(), fechaVencimiento: zFecha.nullish(),
  renglones: z.array(z.object({ base: z.number().gt(0, 'La base imponible debe ser mayor que cero'), alicuotaIva: z.number().refine((a) => a === 21 || a === 10.5, 'El despacho admite alícuotas de 21 % y 10,5 %') })).min(1, 'Cargue al menos una base imponible'),
  percepcionIva: z.number().min(0).default(0), percepcionGanancias: z.number().min(0).default(0),
  percepcionesIibb: z.array(z.object({ jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'), importe: z.number().gt(0) })).default([]),
  derechosImportacion: z.number().min(0).default(0), tasaEstadistica: z.number().min(0).default(0),
  totalDeclarado: z.number({ required_error: 'Ingrese el total liquidado del despacho' }).min(0),
  destinoCreditoIva: z.enum(['GRAVADO', 'EXENTO', 'COMUN']).optional(),
  // No lleva letra ni número de comprobante: si vienen, se rechaza
  letra: z.unknown().optional(), puntoVenta: z.unknown().optional(), numero: z.unknown().optional(),
});
export type DatosDespacho = z.infer<typeof esquemaDespacho>;
