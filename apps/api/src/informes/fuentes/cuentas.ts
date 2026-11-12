import { Prisma } from '@prisma/client';
import { saldosAFecha } from '../../finanzas/saldos';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import { Tramo, TRAMOS, tramoDe } from '../calculo';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface FilaAntiguedad { terceroId: string; nombre: string; aVencer: string; d1_30: string; d31_60: string; d61_90: string; mas90: string; aFavor: string; total: string }

/** Saldos pendientes por tramo de vencimiento (spec §2): saldo actual de movimientos no anulados con fecha ≤ corte; negativos a favor. */
export async function antiguedad(tx: TxEmpresa, tipo: 'clientes' | 'proveedores', corte: Date): Promise<{ filas: FilaAntiguedad[]; totales: Omit<FilaAntiguedad, 'terceroId' | 'nombre'> }> {
  // Saldo de cada comprobante a la fecha de corte (no el actual): spec E15 §3
  const movs = await saldosAFecha(tx, tipo, corte);
  const terceros = new Map((await tx.tercero.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.terceroId))] } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
  const vacio = () => ({ aVencer: new D(0), d1_30: new D(0), d31_60: new D(0), d61_90: new D(0), mas90: new D(0), aFavor: new D(0) }) as Record<Tramo | 'aFavor', Dec>;
  const porTercero = new Map<string, Record<Tramo | 'aFavor', Dec>>();
  const tot = vacio();
  for (const m of movs) {
    const f = porTercero.get(m.terceroId) ?? vacio();
    const saldo = new D(m.saldoPesos);
    const k = saldo.lt(0) ? 'aFavor' : tramoDe(corte, m.fechaVencimiento);
    f[k] = f[k].plus(saldo);
    tot[k] = tot[k].plus(saldo);
    porTercero.set(m.terceroId, f);
  }
  const fmt = (f: Record<Tramo | 'aFavor', Dec>) => {
    const total = [...TRAMOS, 'aFavor' as const].reduce((s, k) => s.plus(f[k]), new D(0));
    return { aVencer: f.aVencer.toFixed(2), d1_30: f.d1_30.toFixed(2), d31_60: f.d31_60.toFixed(2), d61_90: f.d61_90.toFixed(2), mas90: f.mas90.toFixed(2), aFavor: f.aFavor.toFixed(2), total: total.toFixed(2), _total: total };
  };
  const filas = [...porTercero].map(([terceroId, f]) => ({ terceroId, nombre: terceros.get(terceroId) ?? '', ...fmt(f) }))
    .sort((a, b) => b._total.cmp(a._total)).map(({ _total, ...x }) => { void _total; return x; });
  const { _total, ...totales } = fmt(tot);
  void _total;
  return { filas, totales };
}
