import { BadRequestException } from '@nestjs/common';
import { CuentaContable, Ejercicio, Prisma, TipoAsiento } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export interface FiltroSaldos {
  ejercicioId: string;
  desde?: Date;
  hasta?: Date;
  excluirTipos?: TipoAsiento[];
  centroCostoId?: string;
}

/** Debe y haber por cuenta imputable, sumando los renglones de los asientos que cumplen el filtro. */
export async function saldosPorCuenta(tx: TxEmpresa, f: FiltroSaldos): Promise<Map<string, { debe: Dec; haber: Dec }>> {
  const g = await tx.asientoRenglon.groupBy({
    by: ['cuentaContableId'],
    where: {
      centroCostoId: f.centroCostoId || undefined,
      asiento: { ejercicioId: f.ejercicioId, fecha: { gte: f.desde, lte: f.hasta }, tipo: f.excluirTipos?.length ? { notIn: f.excluirTipos } : undefined },
    },
    _sum: { debe: true, haber: true },
  });
  return new Map(g.map((x) => [x.cuentaContableId, { debe: x._sum.debe ?? new D(0), haber: x._sum.haber ?? new D(0) }]));
}

export const nivelDe = (codigo: string) => codigo.split('.').length;
export const esDescendiente = (codigo: string, rubro: string) => codigo === rubro || codigo.startsWith(`${rubro}.`);

export interface FilaArbol {
  cuentaId: string; codigo: string; nombre: string; nivel: number; imputable: boolean; tipo: string;
  debe: string; haber: string; saldoDeudor: string; saldoAcreedor: string;
}

/** Cuentas con movimiento y todos sus rubros ascendentes, con las sumas de sus descendientes; hasta `nivel`. */
export function arbolSaldos(cuentas: CuentaContable[], saldos: Map<string, { debe: Dec; haber: Dec }>, nivel = 99): FilaArbol[] {
  const conMovimiento = cuentas.filter((c) => saldos.has(c.id));
  const visibles = cuentas.filter((c) => conMovimiento.some((m) => esDescendiente(m.codigo, c.codigo)) && nivelDe(c.codigo) <= nivel);
  return visibles
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
    .map((c) => {
      let debe = new D(0);
      let haber = new D(0);
      for (const m of conMovimiento) if (esDescendiente(m.codigo, c.codigo)) {
        const s = saldos.get(m.id)!;
        debe = debe.plus(s.debe);
        haber = haber.plus(s.haber);
      }
      const saldo = debe.minus(haber);
      return {
        cuentaId: c.id, codigo: c.codigo, nombre: c.nombre, nivel: nivelDe(c.codigo), imputable: c.imputable, tipo: c.tipo,
        debe: debe.toString(), haber: haber.toString(),
        saldoDeudor: (saldo.gt(0) ? saldo : new D(0)).toString(), saldoAcreedor: (saldo.lt(0) ? saldo.neg() : new D(0)).toString(),
      };
    });
}

/** Ejercicio que contiene la fecha (400 si no hay). */
export async function ejercicioDe(tx: TxEmpresa, fecha: Date): Promise<Ejercicio> {
  const e = await tx.ejercicio.findFirst({ where: { desde: { lte: fecha }, hasta: { gte: fecha } } });
  if (!e) throw new BadRequestException('No hay un ejercicio contable para la fecha indicada');
  return e;
}

/** Ejercicio del rango; 400 si desde y hasta caen en ejercicios distintos. Sin fechas, el que contiene hoy o el último. */
export async function ejercicioDelRango(tx: TxEmpresa, desde: Date | undefined, hasta: Date | undefined, hoy: Date, ejercicioId?: string): Promise<Ejercicio> {
  if (desde && hasta && desde > hasta) throw new BadRequestException('La fecha desde no puede ser posterior a la fecha hasta');
  if (ejercicioId) {
    const e = await tx.ejercicio.findUnique({ where: { id: ejercicioId } });
    if (!e) throw new BadRequestException('Ejercicio inexistente');
    if ((desde && (desde < e.desde || desde > e.hasta)) || (hasta && (hasta < e.desde || hasta > e.hasta))) throw new BadRequestException('El rango debe estar dentro de un mismo ejercicio');
    return e;
  }
  if (desde || hasta) {
    const a = await ejercicioDe(tx, desde ?? hasta!);
    if (desde && hasta && hasta > a.hasta) throw new BadRequestException('El rango debe estar dentro de un mismo ejercicio');
    return a;
  }
  return (await tx.ejercicio.findFirst({ where: { desde: { lte: hoy }, hasta: { gte: hoy } } })) ?? (await tx.ejercicio.findFirstOrThrow({ orderBy: { numero: 'desc' } }));
}
