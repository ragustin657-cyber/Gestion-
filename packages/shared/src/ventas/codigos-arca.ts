import { CondicionIva } from '../condicion-iva';
import type { AlicuotaIva } from '../iva';
import type { LetraVenta, TipoVenta } from './letra';

const CBTE: Record<TipoVenta, Record<LetraVenta, number>> = {
  FACTURA: { A: 1, B: 6, C: 11 },
  NOTA_DEBITO: { A: 2, B: 7, C: 12 },
  NOTA_CREDITO: { A: 3, B: 8, C: 13 },
};
export const cbteTipo = (tipo: TipoVenta, letra: LetraVenta): number => CBTE[tipo][letra];

/** Condición frente al IVA del receptor (RG 5616). NO_RESPONSABLE → 15 "IVA No Alcanzado": a verificar por el contador. */
const RECEPTOR: Record<CondicionIva, number> = {
  [CondicionIva.RESPONSABLE_INSCRIPTO]: 1,
  [CondicionIva.EXENTO]: 4,
  [CondicionIva.CONSUMIDOR_FINAL]: 5,
  [CondicionIva.MONOTRIBUTO]: 6,
  [CondicionIva.NO_RESPONSABLE]: 15,
};
export const condicionIvaReceptorArca = (c: CondicionIva | `${CondicionIva}`): number => RECEPTOR[c as CondicionIva];

const ALICUOTA: Record<string, number> = { '0': 3, '2.5': 9, '5': 8, '10.5': 4, '21': 5, '27': 6 };
export const alicuotaArca = (a: AlicuotaIva): number => ALICUOTA[String(a)];

export const docTipoArca = (t: 'CUIT' | 'DNI' | 'OTRO'): number => ({ CUIT: 80, DNI: 96, OTRO: 99 })[t];
export const monedaArca = (codigo: 'ARS' | 'USD'): 'PES' | 'DOL' => (codigo === 'ARS' ? 'PES' : 'DOL');
