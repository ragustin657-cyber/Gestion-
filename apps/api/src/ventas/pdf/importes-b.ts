import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

/**
 * Importe con IVA de cada renglón de una factura B. El IVA de cada alícuota se reparte entre sus renglones
 * y el redondeo va al renglón mayor, así la suma de renglones es exactamente el total del comprobante.
 */
export function importesConIva(renglones: { neto: string; iva: string; alicuota: string }[], ivas: { alicuota: string; importe: string }[]): string[] {
  const r = renglones.map((x) => new D(x.neto).plus(x.iva));
  for (const iva of ivas) {
    const clave = new D(iva.alicuota).toString();
    const idx = renglones.map((x, i) => (x.alicuota !== 'NO_GRAVADO' && x.alicuota !== 'EXENTO' && new D(x.alicuota).toString() === clave ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const ivaRenglones = idx.reduce((s, i) => s.plus(renglones[i].iva), new D(0));
    const dif = new D(iva.importe).minus(ivaRenglones);
    if (dif.isZero()) continue;
    const mayor = idx.reduce((m, i) => (new D(renglones[i].neto).gt(renglones[m].neto) ? i : m), idx[0]);
    r[mayor] = r[mayor].plus(dif);
  }
  return r.map((x) => x.toFixed(2));
}
