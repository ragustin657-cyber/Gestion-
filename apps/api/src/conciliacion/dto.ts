import { z } from 'zod';
import { columnaValida } from './interprete';

const zColumna = z.string().trim().refine(columnaValida, 'Columna inválida (número o letra)');
const zColumnaOpcional = zColumna.nullish().or(z.literal('').transform(() => null));

export const esquemaFormato = z
  .object({
    tipoArchivo: z.enum(['CSV', 'XLSX']),
    separador: z.enum([',', ';']).nullish(),
    hoja: z.string().trim().nullish(),
    filaInicio: z.number().int().min(1).max(100),
    formatoFecha: z.enum(['DD/MM/AAAA', 'DD-MM-AAAA', 'AAAA-MM-DD']),
    separadorDecimal: z.enum([',', '.']),
    columnaFecha: zColumna,
    columnaConcepto: zColumna,
    columnaReferencia: zColumnaOpcional,
    columnaSaldo: zColumnaOpcional,
    modoImporte: z.enum(['IMPORTE_CON_SIGNO', 'DEBITO_CREDITO']),
    columnaImporte: zColumnaOpcional,
    columnaDebito: zColumnaOpcional,
    columnaCredito: zColumnaOpcional,
  })
  .superRefine((f, ctx) => {
    if (f.tipoArchivo === 'CSV' && !f.separador) ctx.addIssue({ code: 'custom', path: ['separador'], message: 'Indique el separador' });
    if (f.modoImporte === 'IMPORTE_CON_SIGNO' && !f.columnaImporte) ctx.addIssue({ code: 'custom', path: ['columnaImporte'], message: 'Indique la columna del importe' });
    if (f.modoImporte === 'DEBITO_CREDITO') {
      if (!f.columnaDebito) ctx.addIssue({ code: 'custom', path: ['columnaDebito'], message: 'Indique la columna de débitos' });
      if (!f.columnaCredito) ctx.addIssue({ code: 'custom', path: ['columnaCredito'], message: 'Indique la columna de créditos' });
    }
  });
export type DatosFormato = z.infer<typeof esquemaFormato>;

const zFechaTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Fecha inválida').transform((s) => new Date(`${s}T00:00:00Z`));
const zId = z.string().uuid('Valor inválido');

export const esquemaConciliacion = z.object({
  cuentaBancariaId: zId,
  desde: zFechaTexto,
  hasta: zFechaTexto,
  saldoInicial: z.number().finite().nullish(),
  saldoFinal: z.number({ required_error: 'Campo obligatorio' }).finite(),
}).refine((c) => c.desde <= c.hasta, { message: 'La fecha desde no puede ser posterior a la fecha hasta', path: ['hasta'] });
export type DatosConciliacion = z.infer<typeof esquemaConciliacion>;

export const esquemaVinculo = z.object({ lineas: z.array(zId), movimientos: z.array(zId) });
export type DatosVinculo = z.infer<typeof esquemaVinculo>;
export const esquemaLote = z.object({ vinculos: z.array(esquemaVinculo).min(1, 'Indique al menos una coincidencia') });
export const esquemaMotivo = z.object({ motivo: z.string().trim().min(1, 'Debe indicar el motivo') });
