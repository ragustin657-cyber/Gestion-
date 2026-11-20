import { ConfigImpuestos, Prisma } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ventasDelAmbiente } from '../libros-iva/libro-ventas.service';
import { coeficienteProrrateo, mesesDelEjercicio } from './prorrateo';

const D = Prisma.Decimal;
const indice = (anio: number, mes: number) => anio * 12 + mes;

/** Ventas gravadas y exentas/no gravadas en pesos (NC restan) del ambiente vigente entre dos fechas (spec E40 §4). */
export async function ventasProrrateo(tx: TxEmpresa, desde: Date, hasta: Date): Promise<{ gravadas: Prisma.Decimal; exentas: Prisma.Decimal }> {
  const { ambiente } = await ventasDelAmbiente(tx, desde, hasta);
  const vs = await tx.comprobanteVenta.findMany({ where: { estado: 'AUTORIZADO', ambiente, fecha: { gte: desde, lte: hasta } }, select: { tipo: true, netoGravado: true, exento: true, noGravado: true, cotizacion: true } });
  let gravadas = new D(0), exentas = new D(0);
  for (const v of vs) {
    const s = v.tipo === 'NOTA_CREDITO' ? -1 : 1;
    gravadas = gravadas.plus(v.netoGravado.mul(v.cotizacion).toDecimalPlaces(2).mul(s));
    exentas = exentas.plus(v.exento.plus(v.noGravado).mul(v.cotizacion).toDecimalPlaces(2).mul(s));
  }
  return { gravadas, exentas };
}

/** ¿El mes tiene prorrateo? Activo y desde su primer mes. */
export const conProrrateo = (c: ConfigImpuestos, anio: number, mes: number) =>
  c.prorrateoIva && !!c.prorrateoDesdeAnio && !!c.prorrateoDesdeMes && indice(anio, mes) >= indice(c.prorrateoDesdeAnio, c.prorrateoDesdeMes);

/**
 * Coeficiente acumulado del ejercicio fiscal hasta el mes (spec E40 §4). En el ejercicio del primer mes con prorrateo el acumulado
 * empieza en ese mes y suma las ventas iniciales configuradas. Devuelve también los meses del ejercicio con prorrateo.
 */
export async function coeficienteDelMes(tx: TxEmpresa, c: ConfigImpuestos, anio: number, mes: number) {
  const ejercicio = mesesDelEjercicio(anio, mes, c.prorrateoInicioMes);
  const meses = ejercicio.filter((m) => indice(m.anio, m.mes) >= indice(c.prorrateoDesdeAnio!, c.prorrateoDesdeMes!));
  const primero = meses[0];
  const v = await ventasProrrateo(tx, new Date(Date.UTC(primero.anio, primero.mes - 1, 1)), new Date(Date.UTC(anio, mes, 0)));
  const conIniciales = ejercicio.some((m) => m.anio === c.prorrateoDesdeAnio && m.mes === c.prorrateoDesdeMes);
  const gravadas = v.gravadas.plus(conIniciales ? c.prorrateoGravadasIniciales : 0), exentas = v.exentas.plus(conIniciales ? c.prorrateoExentasIniciales : 0);
  return { ...coeficienteProrrateo(gravadas.toFixed(2), exentas.toFixed(2)), meses };
}
