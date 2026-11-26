import { CondicionIva } from '../condicion-iva';

export type LetraVenta = 'A' | 'B' | 'C' | 'E';
export type TipoVenta = 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';

/** LetraVenta del comprobante de venta según la condición de IVA de la empresa y del cliente. */
/** E58: con `exportacion` la letra es E (factura de exportación), para cualquier empresa que emita. */
export function letraVenta(empresa: CondicionIva | `${CondicionIva}`, cliente: CondicionIva | `${CondicionIva}`, exportacion = false): LetraVenta {
  if (exportacion && (empresa === CondicionIva.RESPONSABLE_INSCRIPTO || empresa === CondicionIva.MONOTRIBUTO || empresa === CondicionIva.EXENTO)) return 'E';
  if (empresa === CondicionIva.RESPONSABLE_INSCRIPTO)
    return cliente === CondicionIva.RESPONSABLE_INSCRIPTO || cliente === CondicionIva.MONOTRIBUTO ? 'A' : 'B';
  if (empresa === CondicionIva.MONOTRIBUTO || empresa === CondicionIva.EXENTO) return 'C';
  throw new Error('La condición de IVA de la empresa no permite emitir comprobantes');
}
