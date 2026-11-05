import type { MovimientoCuentaCorriente } from '@prisma/client';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';

const ABREV: Record<string, string> = { FACTURA: 'FC', NOTA_DEBITO: 'ND', NOTA_CREDITO: 'NC', TICKET: 'TK' };
const num = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`;

/** Descripción legible de cada movimiento de cuenta corriente (comprobante o anticipo). */
export async function describirMovimientos(tx: TxEmpresa, movs: Pick<MovimientoCuentaCorriente, 'id' | 'origenTipo' | 'origenId'>[]) {
  const comps = await tx.comprobanteCompra.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'COMPRA').map((m) => m.origenId) } } });
  const ops = await tx.ordenPago.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'ANTICIPO').map((m) => m.origenId) } } });
  const r = new Map<string, string>();
  for (const m of movs) {
    if (m.origenTipo === 'COMPRA') {
      const c = comps.find((x) => x.id === m.origenId);
      r.set(m.id, c ? `${ABREV[c.tipo]} ${c.letra} ${num(c.puntoVenta, c.numero)}`.replace(/\s+/g, ' ') : 'Comprobante');
    } else if (m.origenTipo === 'ANTICIPO') {
      const o = ops.find((x) => x.id === m.origenId);
      r.set(m.id, `Anticipo OP ${o?.numero ? `0001-${String(o.numero).padStart(8, '0')}` : ''}`.trim());
    } else r.set(m.id, m.origenTipo);
  }
  return r;
}

/** Comprobante de compra asociado a cada movimiento (para la base sin IVA). */
export async function comprobantesDe(tx: TxEmpresa, movs: Pick<MovimientoCuentaCorriente, 'origenTipo' | 'origenId'>[]) {
  return tx.comprobanteCompra.findMany({ where: { id: { in: movs.filter((m) => m.origenTipo === 'COMPRA').map((m) => m.origenId) } } });
}
