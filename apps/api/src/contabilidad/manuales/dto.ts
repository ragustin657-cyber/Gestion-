import { z } from 'zod';
import { zFecha, zMotivo } from '../../compras/comun';

const dosDecimales = (n: number) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
const zLado = z.number().finite().min(0, 'No puede ser negativo').refine(dosDecimales, 'Hasta dos decimales').nullish();

export const zRenglon = z
  .object({
    cuentaContableId: z.string().uuid('Cuenta inválida'),
    centroCostoId: z.string().uuid().nullish(),
    debe: zLado,
    haber: zLado,
    detalle: z.string().trim().max(200).nullish(),
  })
  .superRefine((r, ctx) => {
    const d = r.debe ?? 0;
    const h = r.haber ?? 0;
    if (d > 0 && h > 0) ctx.addIssue({ code: 'custom', path: ['debe'], message: 'Un renglón lleva debe o haber, no ambos' });
    else if (d <= 0 && h <= 0) ctx.addIssue({ code: 'custom', path: ['debe'], message: 'Indique un importe mayor a cero en el debe o en el haber' });
  });

export const esquemaAsiento = z.object({
  fecha: zFecha,
  descripcion: z.string().trim().min(1, 'Campo obligatorio').max(300),
  renglones: z.array(zRenglon).min(2, 'El asiento necesita al menos dos renglones'),
});
export type DatosAsientoManual = z.infer<typeof esquemaAsiento>;
export const esquemaModificacion = esquemaAsiento.extend({ version: z.number().int().min(0) });
export const esquemaAnulacion = z.object({ fecha: zFecha, motivo: zMotivo });
