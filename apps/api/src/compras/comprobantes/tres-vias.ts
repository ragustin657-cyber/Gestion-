import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export interface LineaTresVias {
  indice: number;
  precioFacturado: string;
  precioOc: string;
  cantidadFacturada: string;
  pendienteFacturar: string;
}

export interface Diferencia {
  renglon: number;
  tipo: 'PRECIO' | 'CANTIDAD';
  esperado: string;
  facturado: string;
  diferenciaPct: string;
}

/** Compara precio facturado vs. precio de la OC y cantidad vs. pendiente de facturar, según tolerancias en %. */
export function detectarDiferencias(lineas: LineaTresVias[], tol: { precioPct: string; cantidadPct: string }): Diferencia[] {
  const r: Diferencia[] = [];
  for (const l of lineas) {
    const pf = new D(l.precioFacturado), po = new D(l.precioOc);
    if (!pf.eq(po)) {
      const pct = po.isZero() ? new D(100) : pf.minus(po).abs().div(po).mul(100);
      if (pct.gt(tol.precioPct))
        r.push({ renglon: l.indice, tipo: 'PRECIO', esperado: po.toString(), facturado: pf.toString(), diferenciaPct: pct.toFixed(2) });
    }
    const cf = new D(l.cantidadFacturada), pend = new D(l.pendienteFacturar);
    if (cf.gt(pend)) {
      const pct = pend.isZero() ? new D(100) : cf.minus(pend).div(pend).mul(100);
      if (pct.gt(tol.cantidadPct))
        r.push({ renglon: l.indice, tipo: 'CANTIDAD', esperado: pend.toString(), facturado: cf.toString(), diferenciaPct: pct.toFixed(2) });
    }
  }
  return r;
}
