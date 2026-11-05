import { CondicionIva } from '../condicion-iva';

export type Letra = 'A' | 'B' | 'C' | 'M';

const RI = CondicionIva.RESPONSABLE_INSCRIPTO;
const MONO = CondicionIva.MONOTRIBUTO;
const EX = CondicionIva.EXENTO;

/** Letras de comprobante que la empresa puede recibir de un proveedor, según ambas condiciones de IVA. */
export function letrasValidas(empresa: CondicionIva, proveedor: CondicionIva): Letra[] {
  if (empresa === RI) {
    if (proveedor === RI) return ['A', 'M'];
    if (proveedor === MONO) return ['C'];
    if (proveedor === EX) return ['B', 'C'];
    return [];
  }
  if (empresa === MONO || empresa === EX) {
    if (proveedor === RI) return ['B'];
    if (proveedor === MONO) return ['C'];
  }
  return [];
}

/** Solo las letras A y M discriminan IVA (crédito fiscal). */
export const discriminaIva = (letra: Letra | null | undefined): boolean => letra === 'A' || letra === 'M';
