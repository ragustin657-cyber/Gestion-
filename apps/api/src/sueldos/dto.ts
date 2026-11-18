import { z } from 'zod';
import { validarConcepto } from './calculo';

const uuid = z.string().uuid('Valor inválido');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
export const esquemaConvenio = z.object({ nombre: z.string().trim().min(1).max(100), codigo: z.string().trim().min(1).max(30), horasMensuales: z.number().int().min(1).max(400), activo: z.boolean().optional() });
export const esquemaCategoria = z.object({ convenioId: uuid, nombre: z.string().trim().min(1).max(100), orden: z.number().int().min(0).default(0), activa: z.boolean().optional() });
export const esquemaEscala = z.object({ categoriaId: uuid, anio: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), basico: z.number().positive('Debe ser mayor que cero') });
export const esquemaTope = z.object({ convenioId: uuid, desdeAnio: z.number().int().min(2000).max(2100), desdeMes: z.number().int().min(1).max(12), importe: z.number().positive('Debe ser mayor que cero') });
export const esquemaEmpleado = z.object({
  apellido: z.string().trim().min(1).max(100), nombre: z.string().trim().min(1).max(100), cuil: z.string().trim().min(11), domicilio: z.string().trim().max(200).default(''),
  fechaIngreso: fecha, fechaEgreso: fecha.nullish(), categoriaId: uuid, centroCostoId: uuid.nullish(), sucursalId: uuid.nullish(),
  afiliadoSindicato: z.boolean().default(false), obraSocial: z.string().trim().max(100).default(''), formaPago: z.enum(['EFECTIVO', 'TRANSFERENCIA']).default('TRANSFERENCIA'),
  cbu: z.string().trim().regex(/^\d{22}$/, 'CBU inválido').nullish(), activo: z.boolean().optional(),
  codigoSituacion: z.number().int().min(0).max(99).optional(), codigoCondicion: z.number().int().min(0).max(99).optional(), codigoActividad: z.number().int().min(0).max(999).optional(),
  codigoModalidad: z.number().int().min(0).max(999).optional(), codigoZona: z.number().int().min(0).max(99).nullish(),
  codigoObraSocial: z.string().trim().regex(/^\d{6}$/, 'Código de obra social inválido: 6 dígitos').optional(), conyuge: z.boolean().optional(),
  cantidadHijos: z.number().int().min(0).max(99).optional(), adherentesObraSocial: z.number().int().min(0).max(99).optional(), trabajadorConvencionado: z.boolean().optional(),
  codigoSiniestrado: z.number().int().min(0).max(99).optional(), regimen: z.number().int().min(0).max(9).optional(),
});
export const esquemaEdicionEmpleado = esquemaEmpleado.partial();
export const esquemaConcepto = z.object({
  convenioId: uuid.nullish(), codigo: z.string().trim().min(1).max(10), nombre: z.string().trim().min(1).max(100),
  clase: z.enum(['REMUNERATIVO', 'NO_REMUNERATIVO', 'DESCUENTO']),
  tipo: z.enum(['BASICO', 'ANTIGUEDAD', 'PORCENTAJE', 'HORAS_EXTRA', 'AUSENCIA', 'FIJO', 'DESCUENTO_LEY', 'VACACIONES']),
  parametros: z.record(z.unknown()).default({}), orden: z.number().int(), soloAfiliados: z.boolean().default(false), activo: z.boolean().optional(),
  destino: z.enum(['SEGURIDAD_SOCIAL', 'OBRA_SOCIAL', 'SINDICAL', 'OTRO']).default('OTRO'), cuentaContableId: uuid.nullish(),
  codigoArca: z.string().trim().optional(),
}).superRefine((c, ctx) => {
  const error = validarConcepto(c.tipo, c.clase, c.parametros);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ['parametros'] });
});
export type DatosEmpleado = z.infer<typeof esquemaEmpleado>;
export type DatosConcepto = z.infer<typeof esquemaConcepto>;
