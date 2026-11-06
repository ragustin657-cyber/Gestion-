import type { AlicuotaIva } from '../iva';
import { a2, D, Dec } from '../compras/decimal';
import type { LetraVenta } from './letra';

export type AlicuotaVenta = AlicuotaIva | 'NO_GRAVADO' | 'EXENTO';
export interface RenglonCalculo { cantidad: string; precioUnitario: string; alicuota: AlicuotaVenta }
export interface ResultadoVenta {
  renglones: { neto: string; iva: string }[];
  netoGravado: string; noGravado: string; exento: string; iva: string; total: string;
  ivas: { alicuota: AlicuotaIva; base: string; importe: string }[];
}

/**
 * Importes del comprobante. El IVA de cada alícuota se calcula sobre su base sumada (redondeo a 2),
 * igual que lo valida ARCA; el IVA por renglón es informativo. La letra C no discrimina IVA.
 */
export function calcularVenta(renglones: RenglonCalculo[], letra: LetraVenta): ResultadoVenta {
  const netos = renglones.map((r) => new D(new D(r.cantidad).mul(r.precioUnitario).toDecimalPlaces(2)));
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
  const ivas = c ? [] : [...bases].map(([alicuota, base]) => ({ alicuota, base: a2(base), importe: a2(base.mul(alicuota).div(100)) }));
  const iva = ivas.reduce((s: Dec, x) => s.plus(x.importe), new D(0));
  const total = gravado.plus(noGravado).plus(exento).plus(iva);
  return {
    renglones: renglones.map((r, i) => ({
      neto: a2(netos[i]),
      iva: c || typeof r.alicuota !== 'number' ? '0.00' : a2(netos[i].mul(r.alicuota).div(100)),
    })),
    netoGravado: a2(c ? total : gravado), noGravado: a2(c ? new D(0) : noGravado), exento: a2(c ? new D(0) : exento), iva: a2(iva), total: a2(total), ivas,
  };
}
