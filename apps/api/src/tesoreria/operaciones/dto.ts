import { z } from 'zod';
import { normalizarCuit, validarCuit } from '@gestion/shared';
import { zFecha, zMotivo } from '../../compras/comun';
import { zTexto, zTextoOpcional } from '../../comun/esquemas';

export const zImporte = z.number({ required_error: 'Campo obligatorio' }).gt(0, 'Debe ser mayor a cero').finite();
export const zId = z.string().uuid('Valor inválido');
export const zIds = z.array(zId);
export const esquemaAnular = z.object({ motivo: zMotivo });

const zCuitOpcional = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((s) => !s || validarCuit(s), 'CUIT inválido')
  .transform((s) => (s ? normalizarCuit(s) : ''));

export const esquemaChequeIngreso = z.object({
  tipo: z.enum(['FISICO', 'ECHEQ']),
  banco: zTexto,
  numero: zTexto,
  libradorNombre: zTexto,
  libradorCuit: zCuitOpcional,
  fechaEmision: zFecha,
  fechaPago: zFecha,
  importe: zImporte,
});

export const esquemaIngreso = z.object({
  fecha: zFecha,
  cajaId: zId,
  origen: z.enum(['CLIENTE', 'OTRO']),
  terceroId: zId.nullish(),
  cuentaContableId: zId.nullish(),
  concepto: zTexto,
  efectivo: z.object({ importe: zImporte }).nullish(),
  cheques: z.array(esquemaChequeIngreso).default([]),
  transferencias: z.array(z.object({ cuentaBancariaId: zId, fecha: zFecha, referencia: zTextoOpcional, importe: zImporte })).default([]),
});
export type DatosIngreso = z.infer<typeof esquemaIngreso>;
