import { CondicionIva, TipoDocumento } from '@prisma/client';
import { validarCuit, normalizarCuit } from '@gestion/shared';
import { z } from 'zod';
import { zTexto, zTextoOpcional } from '../comun/esquemas';

const base = z.object({
  razonSocial: zTexto,
  nombreFantasia: zTextoOpcional,
  cuit: z.string({ required_error: 'Campo obligatorio' }).trim().min(1, 'Campo obligatorio'),
  tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
  condicionIva: z.nativeEnum(CondicionIva),
  esProveedor: z.boolean().default(false),
  esCliente: z.boolean().default(false),
  domicilio: zTextoOpcional,
  localidad: zTextoOpcional,
  provincia: zTextoOpcional,
  email: z.string().trim().email('Email inválido').optional().nullable().or(z.literal('')),
  telefono: zTextoOpcional,
  diasPago: z.number().int().min(0).max(365).nullish().transform((v) => v ?? undefined),
  regimenGanancias: zTextoOpcional,
  exentoGanancias: z.boolean().optional(),
  exentoIva: z.boolean().optional(),
  exencionHasta: z.coerce.date().optional().nullable(),
  inscriptoGanancias: z.boolean().optional(),
  activo: z.boolean().optional(),
});

const tipo = (t: { esProveedor?: boolean; esCliente?: boolean }) => t.esProveedor || t.esCliente;
const msgTipo = { message: 'Debe ser proveedor, cliente o ambos', path: ['esProveedor'] };

/** El número de documento según su tipo: CUIT con dígito verificador, DNI de 7 u 8 dígitos, OTRO libre. */
function documento<T extends { cuit?: string; tipoDocumento?: TipoDocumento }>(t: T, ctx: z.RefinementCtx): T {
  if (t.cuit === undefined) return t;
  const tipoDoc = t.tipoDocumento ?? 'CUIT';
  if (tipoDoc === 'CUIT') {
    if (!validarCuit(t.cuit)) ctx.addIssue({ code: 'custom', message: 'CUIT inválido', path: ['cuit'] });
    else return { ...t, cuit: normalizarCuit(t.cuit) };
  } else if (tipoDoc === 'DNI') {
    const dni = t.cuit.replace(/\./g, '');
    if (!/^\d{7,8}$/.test(dni)) ctx.addIssue({ code: 'custom', message: 'DNI inválido', path: ['cuit'] });
    else return { ...t, cuit: dni };
  }
  return t;
}

export const esquemaAltaTercero = base.refine(tipo, msgTipo).transform(documento);
export const esquemaModTercero = base
  .partial()
  .refine((t) => t.esProveedor === undefined || t.esCliente === undefined || tipo(t), msgTipo)
  .transform(documento);

export const esquemaIibb = z.array(
  z.object({
    jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'),
    alicuotaPercepcion: z.number().min(0).max(100),
    alicuotaRetencion: z.number().min(0).max(100),
    exento: z.boolean().default(false),
  }),
);

export type AltaTercero = z.infer<typeof esquemaAltaTercero>;
export type ModTercero = z.infer<typeof esquemaModTercero>;
export type IibbTercero = z.infer<typeof esquemaIibb>;
