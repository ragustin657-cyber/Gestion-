import { CondicionIva } from '../condicion-iva';

export type LetraVenta = 'A' | 'B' | 'C';
export type TipoVenta = 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';

/** LetraVenta del comprobante de venta según la condición de IVA de la empresa y del cliente. */
export function letraVenta(empresa: CondicionIva | `${CondicionIva}`, cliente: CondicionIva | `${CondicionIva}`): LetraVenta {
  if (empresa === CondicionIva.RESPONSABLE_INSCRIPTO)
    return cliente === CondicionIva.RESPONSABLE_INSCRIPTO || cliente === CondicionIva.MONOTRIBUTO ? 'A' : 'B';
  if (empresa === CondicionIva.MONOTRIBUTO || empresa === CondicionIva.EXENTO) return 'C';
  throw new Error('La condición de IVA de la empresa no permite emitir comprobantes');
}
