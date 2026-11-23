import type { AlicuotaIva } from '../iva';
import { a2, D, Dec } from '../compras/decimal';
import type { LetraVenta } from './letra';

export type AlicuotaVenta = AlicuotaIva | 'NO_GRAVADO' | 'EXENTO';
/** `bonificacionPct` (E51): % de bonificación del renglón; por defecto 0. */
export interface RenglonCalculo { cantidad: string; precioUnitario: string; alicuota: AlicuotaVenta; bonificacionPct?: string }
export interface ResultadoVenta {
  /** `importe`: antes del descuento general (para mostrar); `neto`: el final. */
  renglones: { neto: string; iva: string; importe: string }[];
  /** E51: suma de los importes antes del descuento general, y el descuento (en neto). */
  subtotal: string; descuentoGeneral: string;
  netoGravado: string; noGravado: string; exento: string; iva: string; total: string;
  ivas: { alicuota: AlicuotaIva; base: string; importe: string }[];
}

/**
 * Importes del comprobante. El IVA de cada alícuota se calcula sobre su base sumada (redondeo a 2),
 * igual que lo valida ARCA; el IVA por renglón es informativo. La letra C no discrimina IVA.
 */
export function calcularVenta(renglones: RenglonCalculo[], letra: LetraVenta, descuentoPct = '0'): ResultadoVenta {
  // E51: neto = cantidad × precio × (1 − bonificación) × (1 − descuento general), redondeado una sola vez
  const bruto = (r: RenglonCalculo) => new D(r.cantidad).mul(r.precioUnitario).mul(new D(1).minus(new D(r.bonificacionPct ?? '0').div(100)));
  const importes = renglones.map((r) => bruto(r).toDecimalPlaces(2));
  const factor = new D(1).minus(new D(descuentoPct).div(100));
  const netos = renglones.map((r) => new D(bruto(r).mul(factor).toDecimalPlaces(2)));
  let gravado = new D(0), noGravado = new D(0), exento = new D(0);
  const bases = new Map<AlicuotaIva, Dec>();
  renglones.forEach((r, i) => {
    if (r.alicuota === 'NO_GRAVADO') noGravado = noGravado.plus(netos[i]);
    else if (r.alicuota === 'EXENTO') exento = exento.plus(netos[i]);
    else {
      gravado = gravado.plus(netos[i]);
      bases.set(r.alicuota, (bases.get(r.alicuota) ?? new D(0)).plus(netos[i]));
    }
  });
  const c = letra === 'C';
  // Revisión E51: una alícuota sin base (renglones bonificados al 100 %) no se informa
  const ivas = c ? [] : [...bases].filter(([, base]) => !base.isZero()).map(([alicuota, base]) => ({ alicuota, base: a2(base), importe: a2(base.mul(alicuota).div(100)) }));
  const iva = ivas.reduce((s: Dec, x) => s.plus(x.importe), new D(0));
  const total = gravado.plus(noGravado).plus(exento).plus(iva);
  return {
    renglones: renglones.map((r, i) => ({
      neto: a2(netos[i]), importe: a2(importes[i]),
      iva: c || typeof r.alicuota !== 'number' ? '0.00' : a2(netos[i].mul(r.alicuota).div(100)),
    })),
    subtotal: a2(importes.reduce((s: Dec, x) => s.plus(x), new D(0))),
    descuentoGeneral: a2(importes.reduce((s: Dec, x) => s.plus(x), new D(0)).minus(netos.reduce((s: Dec, x) => s.plus(x), new D(0)))),
    netoGravado: a2(c ? total : gravado), noGravado: a2(c ? new D(0) : noGravado), exento: a2(c ? new D(0) : exento), iva: a2(iva), total: a2(total), ivas,
  };
}
