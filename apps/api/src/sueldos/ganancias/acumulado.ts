import { Concepto, Prisma, RubroExentoGanancias } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { RenglonCalc } from '../calculo';
import { DatosF572 } from './f572-xml';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const cero = () => new D(0);
const DESTINOS = { SEGURIDAD_SOCIAL: 'aportesSS', OBRA_SOCIAL: 'aportesOS', SINDICAL: 'aportesSindical' } as const;
export const RUBROS: RubroExentoGanancias[] = ['ASIGNACIONES_FAMILIARES', 'INTERESES_PRESTAMOS', 'INDEMNIZACIONES', 'CURSOS_SEMINARIOS', 'INDUMENTARIA'];

/** Acumulado del año de un empleado para Ganancias (E32): lo usan la retención mensual, la anual y el F.1359. */
export interface AcumuladoEmpleado {
  /** Bruta gravada de esta empresa sin SAC, y el SAC por cuota (fecha de pago enero–junio / julio–diciembre). */
  brutaSinSac: Dec; sac1: Dec; sac2: Dec;
  exentos: Record<RubroExentoGanancias, Dec>;
  aportesSS: Dec; aportesOS: Dec; aportesSindical: Dec;
  /** Renglones de Ganancias (tipo GANANCIAS) de esta empresa; el ajuste anual (GANANCIAS_AJUSTE) no cuenta. */
  retenido: Dec;
  /** Acumulado previo cargado a mano (pagado fuera del sistema). */
  previo: { bruta: Dec; aportes: Dec; retenido: Dec };
  /** Otros empleadores del F.572, meses 1..mes. */
  otros: { bruta: Dec; aportes: Dec; retenido: Dec };
  f572: DatosF572;
  /** Pagos a cuenta del F.572 computables, meses 1..mes. */
  pagosACuenta: Dec;
  pagosPorTipo: Record<string, Dec>;
  primeraFecha: Date | null; ultimaFecha: Date | null;
}

export const brutaGravada = (a: AcumuladoEmpleado) => a.brutaSinSac.plus(a.sac1).plus(a.sac2).plus(a.previo.bruta).plus(a.otros.bruta);
export const aportesTotales = (a: AcumuladoEmpleado) => a.aportesSS.plus(a.aportesOS).plus(a.aportesSindical).plus(a.previo.aportes).plus(a.otros.aportes);
export const totalExento = (a: AcumuladoEmpleado) => RUBROS.reduce((s, r) => s.plus(a.exentos[r]), cero());

interface RenglonSuma { conceptoId: string | null; codigo: string; clase: string; importe: Prisma.Decimal.Value; fechaPago: Date }

/** Suma un renglón al acumulado según su concepto (aportes por destino, retenido, exento por rubro, SAC o bruta). */
function sumar(a: AcumuladoEmpleado, x: RenglonSuma, conceptos: Map<string, Concepto>) {
  const c = x.conceptoId ? conceptos.get(x.conceptoId) : undefined;
  const imp = new D(x.importe);
  if (x.clase === 'DESCUENTO') {
    if (c?.tipo === 'GANANCIAS') a.retenido = a.retenido.plus(imp);
    else if (c && c.destino in DESTINOS) { const k = DESTINOS[c.destino as keyof typeof DESTINOS]; a[k] = a[k].plus(imp); }
    return;
  }
  if (c?.exentoGanancias) { const r = c.rubroExentoGanancias ?? 'INDUMENTARIA'; a.exentos[r] = a.exentos[r].plus(imp); return; }
  if (!c && x.codigo === '300') { a.exentos.INDEMNIZACIONES = a.exentos.INDEMNIZACIONES.plus(imp); return; }
  if (!c && x.codigo === '200') {
    if (x.fechaPago.getUTCMonth() < 6) a.sac1 = a.sac1.plus(imp); else a.sac2 = a.sac2.plus(imp);
    return;
  }
  a.brutaSinSac = a.brutaSinSac.plus(imp);
}

/**
 * Acumulado del año fiscal hasta una fecha de pago: recibos de liquidaciones cerradas (fecha de pago entre el 1/1 y `hasta.fechaPago`),
 * sin la liquidación excluida, más el recibo en cálculo, el acumulado previo y el F.572 (meses 1..mes).
 */
export async function acumuladoEmpleado(
  tx: TxEmpresa, empleadoId: string, anio: number,
  hasta: { fechaPago: Date; mes: number; excluirLiquidacionId?: string; incluirRecibo?: RenglonCalc[] },
): Promise<AcumuladoEmpleado> {
  const conceptos = new Map((await tx.concepto.findMany()).map((c) => [c.id, c]));
  const renglones = await tx.reciboSueldoRenglon.findMany({
    where: { recibo: { empleadoId, liquidacionId: hasta.excluirLiquidacionId ? { not: hasta.excluirLiquidacionId } : undefined, liquidacion: { estado: 'CERRADA', fechaPago: { gte: new Date(Date.UTC(anio, 0, 1)), lte: hasta.fechaPago } } } },
    include: { recibo: { select: { liquidacion: { select: { fechaPago: true } } } } },
  });
  const a: AcumuladoEmpleado = {
    brutaSinSac: cero(), sac1: cero(), sac2: cero(), exentos: Object.fromEntries(RUBROS.map((r) => [r, cero()])) as Record<RubroExentoGanancias, Dec>,
    aportesSS: cero(), aportesOS: cero(), aportesSindical: cero(), retenido: cero(), previo: { bruta: cero(), aportes: cero(), retenido: cero() },
    otros: { bruta: cero(), aportes: cero(), retenido: cero() }, f572: { cargas: [], otrosEmpleadores: [], deducciones: [], pagosACuenta: [] }, pagosACuenta: cero(), pagosPorTipo: {},
    primeraFecha: null, ultimaFecha: null,
  };
  for (const x of renglones) {
    const fp = x.recibo.liquidacion.fechaPago;
    sumar(a, { ...x, fechaPago: fp }, conceptos);
    if (!a.primeraFecha || fp < a.primeraFecha) a.primeraFecha = fp;
    if (!a.ultimaFecha || fp > a.ultimaFecha) a.ultimaFecha = fp;
  }
  for (const x of hasta.incluirRecibo ?? []) sumar(a, { ...x, conceptoId: x.conceptoId === 'SAC' || x.conceptoId === 'FINAL' ? null : x.conceptoId, fechaPago: hasta.fechaPago }, conceptos);
  const previo = await tx.acumuladoGanancias.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
  if (previo) a.previo = { bruta: new D(previo.bruta), aportes: new D(previo.aportes), retenido: new D(previo.retenido) };
  const f = await tx.f572.findUnique({ where: { empleadoId_anio: { empleadoId, anio } } });
  if (f) a.f572 = { ...(f.datos as unknown as DatosF572) };
  a.f572.pagosACuenta ??= [];
  for (const o of a.f572.otrosEmpleadores) for (const x of o.meses) if (x.mes <= hasta.mes) {
    a.otros.bruta = a.otros.bruta.plus(x.bruta); a.otros.aportes = a.otros.aportes.plus(x.aportes); a.otros.retenido = a.otros.retenido.plus(x.retenido);
  }
  for (const p of a.f572.pagosACuenta) {
    if (p.tipo === 'OTRO') continue;
    const s = p.meses.filter((x) => x.mes <= hasta.mes).reduce((t, x) => t.plus(x.importe), cero());
    a.pagosPorTipo[p.tipo] = (a.pagosPorTipo[p.tipo] ?? cero()).plus(s);
    a.pagosACuenta = a.pagosACuenta.plus(s);
  }
  return a;
}
