import { z } from 'zod';
import { validarCbu } from '@gestion/shared';
import { zTexto, zTextoOpcional } from '../../comun/esquemas';

const zMoneda = z.enum(['ARS', 'USD'], { message: 'Moneda inválida' });

export const esquemaBanco = z.object({ nombre: zTexto, codigoBcra: zTextoOpcional });

export const esquemaCuentaBancaria = z.object({
  bancoId: z.string().uuid(),
  numero: zTexto,
  cbu: z
    .string()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || validarCbu(s), 'CBU inválido')
    .optional()
    .nullable(),
  alias: zTextoOpcional,
  monedaCodigo: zMoneda,
  cuentaContableId: z.string().uuid(),
  activa: z.boolean().optional(),
});

const chequeraBase = z.object({
  cuentaBancariaId: z.string().uuid(),
  tipo: z.enum(['FISICA', 'ECHEQ']),
  desde: z.number().int().positive().optional().nullable(),
  hasta: z.number().int().positive().optional().nullable(),
  activa: z.boolean().optional(),
});
export const esquemaChequera = chequeraBase
  .refine((c) => c.tipo !== 'FISICA' || (c.desde != null && c.hasta != null), {
    message: 'Una chequera física requiere número desde y hasta', path: ['desde'],
  })
  .refine((c) => c.desde == null || c.hasta == null || c.desde <= c.hasta, {
    message: 'El número desde no puede ser mayor que el hasta', path: ['hasta'],
  });
export const esquemaChequeraMod = z.object({ activa: z.boolean() });

export const esquemaCaja = z.object({
  sucursalId: z.string().uuid('Sucursal inválida').optional(),
  nombre: zTexto,
  monedaCodigo: zMoneda,
  cuentaContableId: z.string().uuid(),
  activa: z.boolean().optional(),
});
