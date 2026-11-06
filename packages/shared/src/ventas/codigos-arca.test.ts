import { describe, expect, it } from 'vitest';
import { CondicionIva as C } from '../condicion-iva';
import { alicuotaArca, cbteTipo, condicionIvaReceptorArca, docTipoArca, monedaArca } from './codigos-arca';

describe('códigos ARCA', () => {
  it('tipo de comprobante', () => {
    expect([cbteTipo('FACTURA', 'A'), cbteTipo('NOTA_DEBITO', 'A'), cbteTipo('NOTA_CREDITO', 'A')]).toEqual([1, 2, 3]);
    expect([cbteTipo('FACTURA', 'B'), cbteTipo('NOTA_DEBITO', 'B'), cbteTipo('NOTA_CREDITO', 'B')]).toEqual([6, 7, 8]);
    expect([cbteTipo('FACTURA', 'C'), cbteTipo('NOTA_DEBITO', 'C'), cbteTipo('NOTA_CREDITO', 'C')]).toEqual([11, 12, 13]);
  });
  it('condición IVA del receptor, alícuotas, documento y moneda', () => {
    expect([C.RESPONSABLE_INSCRIPTO, C.EXENTO, C.CONSUMIDOR_FINAL, C.MONOTRIBUTO, C.NO_RESPONSABLE].map(condicionIvaReceptorArca)).toEqual([1, 4, 5, 6, 15]);
    expect(([0, 2.5, 5, 10.5, 21, 27] as const).map(alicuotaArca)).toEqual([3, 9, 8, 4, 5, 6]);
    expect([docTipoArca('CUIT'), docTipoArca('DNI'), docTipoArca('OTRO')]).toEqual([80, 96, 99]);
    expect([monedaArca('ARS'), monedaArca('USD')]).toEqual(['PES', 'DOL']);
  });
});
