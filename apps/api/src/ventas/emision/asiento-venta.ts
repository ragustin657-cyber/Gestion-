import { lineasEnPesos, type LineaMoneda } from '@gestion/shared';
import type { RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';

export interface DatosAsientoVenta {
  tipo: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';
  total: string;
  iva: string;
  cotizacion: string;
  renglones: { cuentaContableId: string; neto: string }[];
  /** Percepciones practicadas (E39), por cuenta de deuda a depositar. */
  percepciones?: { cuentaContableId: string; importe: string }[];
}

/**
 * Renglones en pesos del asiento de un comprobante de venta. Factura y ND: Deudores por ventas al debe;
 * ventas (por cuenta) e IVA débito fiscal al haber. La NC es lo inverso. Los pesos se redondean por línea
 * y la diferencia se ajusta en la línea mayor de cada lado, así el asiento siempre balancea.
 */
export function asientoVenta(c: DatosAsientoVenta, cuentas: { deudores: string; ivaDebito: string }): RenglonAsiento[] {
  const nc = c.tipo === 'NOTA_CREDITO';
  const cliente: 'DEBE' | 'HABER' = nc ? 'HABER' : 'DEBE';
  const contra: 'DEBE' | 'HABER' = nc ? 'DEBE' : 'HABER';
  const porCuenta = new Map<string, InstanceType<typeof D>>();
  for (const r of c.renglones) porCuenta.set(r.cuentaContableId, (porCuenta.get(r.cuentaContableId) ?? new D(0)).plus(r.neto));
  const lineas: LineaMoneda[] = [{ clave: cuentas.deudores, lado: cliente, importe: new D(c.total).toFixed(2) }];
  for (const [cuenta, neto] of porCuenta) if (!neto.isZero()) lineas.push({ clave: cuenta, lado: contra, importe: neto.toFixed(2) });
  if (!new D(c.iva).isZero()) lineas.push({ clave: cuentas.ivaDebito, lado: contra, importe: new D(c.iva).toFixed(2) });
  const porPercepcion = new Map<string, InstanceType<typeof D>>();
  for (const p of c.percepciones ?? []) porPercepcion.set(p.cuentaContableId, (porPercepcion.get(p.cuentaContableId) ?? new D(0)).plus(p.importe));
  for (const [cuenta, imp] of porPercepcion) if (!imp.isZero()) lineas.push({ clave: cuenta, lado: contra, importe: imp.toFixed(2) });
  return lineasEnPesos(lineas, c.cotizacion).map((l) => ({ cuentaContableId: l.clave, [l.lado === 'DEBE' ? 'debe' : 'haber']: l.importe }));
}
