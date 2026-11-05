import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { fechaAR } from '../../compras/comun';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export const MONEDA_DISTINTA = 'La moneda del valor no coincide con la de la cuenta o caja de destino';
export const SALDO_INSUFICIENTE = 'Saldo insuficiente en la caja';

export const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);

export interface DatosMovimiento {
  fecha: Date;
  tipo: 'INGRESO' | 'EGRESO';
  cuentaBancariaId?: string | null;
  cajaId?: string | null;
  monedaCodigo: string;
  importe: Dec | number;
  origenTipo: string;
  origenId: string;
}

/** Registra un movimiento de tesorería (banco o caja). */
export async function registrarMovimiento(tx: TxEmpresa, empresaId: string, m: DatosMovimiento): Promise<void> {
  await tx.movimientoTesoreria.create({
    data: {
      empresaId, fecha: m.fecha, tipo: m.tipo, cuentaBancariaId: m.cuentaBancariaId ?? null, cajaId: m.cajaId ?? null,
      monedaCodigo: m.monedaCodigo, importe: new D(m.importe), origenTipo: m.origenTipo, origenId: m.origenId,
    },
  });
}

/** Anula los movimientos de tesorería de un origen. */
export async function anularMovimientos(tx: TxEmpresa, origenTipo: string, origenId: string): Promise<void> {
  await tx.movimientoTesoreria.updateMany({ where: { origenTipo, origenId, anulado: false }, data: { anulado: true } });
}

async function saldo(tx: TxEmpresa, where: Prisma.MovimientoTesoreriaWhereInput): Promise<Dec> {
  const g = await tx.movimientoTesoreria.groupBy({ by: ['tipo'], where: { ...where, anulado: false }, _sum: { importe: true } });
  const de = (t: string) => g.find((x) => x.tipo === t)?._sum.importe ?? new D(0);
  return de('INGRESO').minus(de('EGRESO'));
}

/** Efectivo de la caja: Σ INGRESO − Σ EGRESO no anulados (opcionalmente hasta una fecha). */
export const saldoCaja = (tx: TxEmpresa, cajaId: string, hasta?: Date) => saldo(tx, { cajaId, fecha: hasta ? { lte: hasta } : undefined });
export const saldoBanco = (tx: TxEmpresa, cuentaBancariaId: string, hasta?: Date) =>
  saldo(tx, { cuentaBancariaId, fecha: hasta ? { lte: hasta } : undefined });

/** Cotización de la moneda a la fecha (la del día o la última anterior). ARS = 1. */
export async function cotizacion(tx: TxEmpresa, monedaCodigo: string, fecha: Date): Promise<Dec> {
  if (monedaCodigo === 'ARS') return new D(1);
  const c = await tx.cotizacion.findFirst({ where: { monedaCodigo, fecha: { lte: fecha } }, orderBy: { fecha: 'desc' } });
  if (!c) throw new BadRequestException(`No hay cotización de ${monedaCodigo} para el ${fechaAR(fecha)}`);
  return c.valor;
}

/** Importe en pesos con la cotización del día, redondeado a 2 decimales. */
export async function aPesos(tx: TxEmpresa, monedaCodigo: string, importe: Dec | number, fecha: Date): Promise<Dec> {
  return new D(importe).mul(await cotizacion(tx, monedaCodigo, fecha)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
