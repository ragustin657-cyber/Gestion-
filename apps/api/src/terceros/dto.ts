import { CondicionIva, SituacionIibb, TipoDocumento } from '@prisma/client';
import { esProvinciaArba, validarCuit, normalizarCuit } from '@gestion/shared';
import { z } from 'zod';
import { zTexto, zTextoOpcional } from '../comun/esquemas';

const base = z.object({
  razonSocial: zTexto,
  // E50: marca manual de obligado a recibir factura de crédito MiPyME (si ARCA no responde)
  fceObligadoManual: z.boolean().optional(),
  nombreFantasia: zTextoOpcional,
  cuit: z.string({ required_error: 'Campo obligatorio' }).trim().min(1, 'Campo obligatorio'),
  tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
  situacionIibb: z.nativeEnum(SituacionIibb).nullish(),
  numeroIibb: z.string().trim().max(20).nullish(),
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
  // Retenciones de IVA y SUSS (E35)
  regimenIvaId: z.string().uuid('Valor inválido').nullish(),
  regimenSussId: z.string().uuid('Valor inválido').nullish(),
  exclusionIvaPorcentaje: z.union([z.literal(50), z.literal(100)], { errorMap: () => ({ message: 'La exclusión es del 50 o del 100 %' }) }).nullish(),
  exclusionIvaPublicacion: z.coerce.date().nullish(),
  exclusionIvaHasta: z.coerce.date().nullish(),
  inscriptoGanancias: z.boolean().optional(),
  // Beneficiario del exterior (E43)
  residenteExterior: z.boolean().optional(),
  nif: zTextoOpcional,
  paisSire: z.number().int().min(0).max(999).nullish(),
  domicilioExterior: zTextoOpcional,
  // E58: CUIT genérico del país (factura de exportación)
  cuitPais: z.string().trim().regex(/^\d{11}$/, 'El CUIT país tiene 11 dígitos').nullish(),
  // E57: domicilio de entrega (destino del COT)
  entregaCalle: zTextoOpcional, entregaNumero: zTextoOpcional, entregaCodigoPostal: zTextoOpcional, entregaLocalidad: zTextoOpcional,
  entregaProvincia: z.string().trim().toUpperCase().refine(esProvinciaArba, 'Provincia inválida (letra de la tabla de ARBA)').nullish(),
  tipoPersona: z.enum(['F', 'J']).nullish(),
  nacimientoPais: z.number().int().min(0).max(999).nullish(),
  nacimientoFecha: z.coerce.date().nullish(),
  regimenExteriorId: z.string().uuid('Valor inválido').nullish(),
  aplicaCdi: z.boolean().optional(),
  acrecentamiento: z.boolean().optional(),
  activo: z.boolean().optional(),
  listaPreciosId: z.string().uuid('Valor inválido').nullish(),
  vendedorId: z.string().uuid('Valor inválido').nullish(),
  sinIntereses: z.boolean().optional(),
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

/**
 * Número de IIBB según la situación: local (8+2) y convenio (3+6+1) de 10 dígitos, o la CUIT (11) como usan las
 * inscripciones más nuevas; simplificado 2+8+1. No inscripto, sin número.
 */
const LARGO_IIBB: Record<string, number[]> = { LOCAL: [10, 11], CONVENIO: [10, 11], SIMPLIFICADO: [11] };
function iibb<T extends { situacionIibb?: SituacionIibb | null; numeroIibb?: string | null }>(t: T, ctx: z.RefinementCtx): void {
  if (!t.situacionIibb || t.situacionIibb === 'NO_INSCRIPTO') return;
  const largos = LARGO_IIBB[t.situacionIibb];
  const n = (t.numeroIibb ?? '').replace(/[-\s]/g, '');
  if (n && !(/^\d+$/.test(n) && largos.includes(n.length))) ctx.addIssue({ code: 'custom', path: ['numeroIibb'], message: `Debe tener ${largos.join(' u ')} dígitos` });
}

/** La exclusión de IVA del SIRE exige su fecha de publicación (F.2005 C13, revisión E35). */
function exclusion<T extends { exclusionIvaPorcentaje?: number | null; exclusionIvaPublicacion?: Date | null }>(t: T, ctx: z.RefinementCtx): void {
  if (t.exclusionIvaPorcentaje && !t.exclusionIvaPublicacion) ctx.addIssue({ code: 'custom', path: ['exclusionIvaPublicacion'], message: 'Indique la fecha de publicación de la exclusión de IVA' });
}

export const esquemaAltaTercero = base.refine(tipo, msgTipo).superRefine(iibb).superRefine(exclusion).transform(documento);
export const esquemaModTercero = base
  .partial()
  .refine((t) => t.esProveedor === undefined || t.esCliente === undefined || tipo(t), msgTipo)
  .superRefine(iibb)
  .superRefine(exclusion)
  .transform(documento);

export const esquemaIibb = z.array(
  z.object({
    jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'),
    alicuotaPercepcion: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
    alicuotaRetencion: z.number().min(0).max(100),
    exento: z.boolean().default(false),
  }),
);

export type AltaTercero = z.infer<typeof esquemaAltaTercero>;
export type ModTercero = z.infer<typeof esquemaModTercero>;
export type IibbTercero = z.infer<typeof esquemaIibb>;
