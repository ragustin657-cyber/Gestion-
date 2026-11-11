import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../prisma/tenant-prisma.service';
import { D, Dec } from '../contabilidad/consultas/saldos';

export interface Mes { anio: number; mes: number }

export const claveMes = (m: Mes) => `${m.anio}-${String(m.mes).padStart(2, '0')}`;
export const mmaaaa = (m: Mes) => `${String(m.mes).padStart(2, '0')}/${m.anio}`;
export const mesDe = (fecha: Date): Mes => ({ anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1 });
export const mesAnterior = (m: Mes): Mes => (m.mes === 1 ? { anio: m.anio - 1, mes: 12 } : { anio: m.anio, mes: m.mes - 1 });

/** Índices de los meses pedidos por clave 'AAAA-MM'; 400 con la lista ordenada de los que faltan. */
export async function indicesPara(tx: TxEmpresa, meses: Mes[]): Promise<Map<string, Dec>> {
  const unicos = new Map(meses.map((m) => [claveMes(m), m]));
  const filas = await tx.indiceInflacion.findMany({ where: { OR: [...unicos.values()].map((m) => ({ anio: m.anio, mes: m.mes })) } });
  const r = new Map<string, Dec>(filas.map((f) => [claveMes(f), new D(f.valor)]));
  const faltan = [...unicos.keys()].filter((k) => !r.has(k)).sort();
  if (faltan.length) throw new BadRequestException(`Faltan los índices de: ${faltan.map((k) => mmaaaa(unicos.get(k)!)).join(', ')}`);
  return r;
}
