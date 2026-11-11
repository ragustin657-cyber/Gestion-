/** Códigos ARCA para el Libro IVA Digital. */

const COMPRA: Record<string, Record<string, number>> = {
  FACTURA: { A: 1, B: 6, C: 11, M: 51 },
  NOTA_DEBITO: { A: 2, B: 7, C: 12, M: 52 },
  NOTA_CREDITO: { A: 3, B: 8, C: 13, M: 53 },
};
/** Código del comprobante de compra; el tique es 083. */
export function codigoCompra(tipo: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO' | 'TICKET', letra: string): number {
  if (tipo === 'TICKET') return 83;
  const c = COMPRA[tipo]?.[letra];
  if (!c) throw new Error(`Sin código ARCA para ${tipo} ${letra}`);
  return c;
}

export const ALICUOTA_LIVA: Record<string, string> = { '0': '0003', '10.5': '0004', '21': '0005', '27': '0006', '5': '0008', '2.5': '0009' };

export function documentoArca(tipoDocumento: 'CUIT' | 'DNI' | 'OTRO'): { codigo: number; numero: (doc: string) => string } {
  if (tipoDocumento === 'OTRO') return { codigo: 99, numero: () => '0' };
  return { codigo: tipoDocumento === 'CUIT' ? 80 : 96, numero: (doc) => doc.replace(/\D/g, '') };
}

/**
 * Código de operación (tabla CODIGO_OPERACION, a revisar por el contador):
 * todo exento → 'E', todo no gravado → 'N', con algo gravado o mezcla → ' ' (no corresponde).
 */
export const CODIGO_OPERACION = { EXENTO: 'E', NO_GRAVADO: 'N', NO_CORRESPONDE: ' ' } as const;
export function codigoOperacion(gravado: boolean, exento: boolean, noGravado: boolean): ' ' | 'E' | 'N' {
  if (!gravado && exento && !noGravado) return CODIGO_OPERACION.EXENTO;
  if (!gravado && !exento && noGravado) return CODIGO_OPERACION.NO_GRAVADO;
  return CODIGO_OPERACION.NO_CORRESPONDE;
}
