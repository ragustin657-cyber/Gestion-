import { z } from 'zod';
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
