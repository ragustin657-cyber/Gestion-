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
