import { CondicionIva } from '@prisma/client';
import { z } from 'zod';
import { zCuit, zTexto, zTextoOpcional } from '../comun/esquemas';

const base = z.object({
  razonSocial: zTexto,
  nombreFantasia: zTextoOpcional,
  cuit: zCuit,
  condicionIva: z.nativeEnum(CondicionIva),
  esProveedor: z.boolean().default(false),
  esCliente: z.boolean().default(false),
  domicilio: zTextoOpcional,
  localidad: zTextoOpcional,
  provincia: zTextoOpcional,
  email: z.string().trim().email('Email inválido').optional().nullable().or(z.literal('')),
  telefono: zTextoOpcional,
  diasPago: z.number().int().min(0).max(365).optional(),
  regimenGanancias: zTextoOpcional,
  exentoGanancias: z.boolean().optional(),
  exentoIva: z.boolean().optional(),
  exencionHasta: z.coerce.date().optional().nullable(),
  activo: z.boolean().optional(),
});

const tipo = (t: { esProveedor?: boolean; esCliente?: boolean }) => t.esProveedor || t.esCliente;
const msgTipo = { message: 'Debe ser proveedor, cliente o ambos', path: ['esProveedor'] };

export const esquemaAltaTercero = base.refine(tipo, msgTipo);
export const esquemaModTercero = base
  .partial()
  .refine((t) => t.esProveedor === undefined || t.esCliente === undefined || tipo(t), msgTipo);

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
