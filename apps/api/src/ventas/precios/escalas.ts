import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';

const dosDecimales = (x: number) => Math.abs(Math.round(x * 100) - x * 100) < 1e-6;

/** E56: lista completa de escalas de un rubro o artículo (el PUT reemplaza todas). */
export const esquemaEscalas = z.object({
  escalas: z.array(z.object({
    desde: z.number().gt(0, 'Debe ser mayor a cero'),
    porcentaje: z.number().gt(0, 'Debe ser mayor a cero').max(100, 'Entre 0 y 100').refine(dosDecimales, 'Hasta 2 decimales'),
  })),
});
export type DatosEscalas = z.infer<typeof esquemaEscalas>;

export const formatoEscalas = (es: { desde: Dec; porcentaje: Dec }[]) =>
  [...es].sort((a, b) => new D(a.desde).cmp(b.desde)).map((e) => ({ desde: new D(e.desde).toString(), porcentaje: new D(e.porcentaje).toString() }));

/** Reemplaza las escalas del dueño (rubro o artículo). */
export async function guardarEscalas(tx: TxEmpresa, empresaId: string, dueno: { rubroId: string } | { articuloId: string }, d: DatosEscalas) {
  const desdes = d.escalas.map((e) => new D(e.desde).toString());
  if (new Set(desdes).size !== desdes.length) throw new BadRequestException('Hay dos escalas con la misma cantidad');
  await tx.escalaDescuento.deleteMany({ where: dueno });
  if (d.escalas.length) await tx.escalaDescuento.createMany({ data: d.escalas.map((e) => ({ empresaId, ...dueno, desde: e.desde, porcentaje: e.porcentaje })) });
  return formatoEscalas(await tx.escalaDescuento.findMany({ where: dueno }));
}

export interface BonificacionSugerida { bonificacionPct: string | null; origen: 'ARTICULO' | 'RUBRO' | null; desde: string | null }

/**
 * E56: % de descuento por cantidad para un renglón (spec §4): las escalas del artículo si tiene alguna; si no, las de su rubro
 * activo; la de mayor `desde` ≤ cantidad.
 */
export async function bonificacionPorCantidad(tx: TxEmpresa, articuloId: string, cantidad: Dec | number): Promise<BonificacionSugerida> {
  const nada: BonificacionSugerida = { bonificacionPct: null, origen: null, desde: null };
  const art = await tx.articulo.findUnique({ where: { id: articuloId }, select: { rubroId: true } });
  if (!art) return nada;
  let origen: 'ARTICULO' | 'RUBRO' = 'ARTICULO';
  let escalas = await tx.escalaDescuento.findMany({ where: { articuloId } });
  if (!escalas.length) {
    if (!art.rubroId) return nada;
    const rubro = await tx.rubroArticulo.findUnique({ where: { id: art.rubroId } });
    if (!rubro?.activo) return nada;
    escalas = await tx.escalaDescuento.findMany({ where: { rubroId: rubro.id } });
    origen = 'RUBRO';
  }
  const q = new D(cantidad);
  const e = escalas.filter((x) => new D(x.desde).lte(q)).sort((a, b) => new D(b.desde).cmp(a.desde))[0];
  return e ? { bonificacionPct: new D(e.porcentaje).toString(), origen, desde: new D(e.desde).toString() } : nada;
}
