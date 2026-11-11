import { importesConIva } from './importes-b';

describe('importes con IVA de una factura B', () => {
  it('los renglones suman exactamente el total (el redondeo va al renglón mayor de la alícuota)', () => {
    const r = importesConIva([{ neto: '0.07', iva: '0.01', alicuota: '21' }, { neto: '0.07', iva: '0.01', alicuota: '21' }, { neto: '0.08', iva: '0.02', alicuota: '21' }], [{ alicuota: '21', importe: '0.05' }]);
    expect(r).toEqual(['0.08', '0.08', '0.11']);
    expect(r.reduce((s: number, x: string) => s + Math.round(Number(x) * 100), 0)).toBe(27);
  });
  it('exentos y no gravados sin IVA', () => {
    expect(importesConIva([{ neto: '10.00', iva: '0.00', alicuota: 'EXENTO' }], [])).toEqual(['10.00']);
  });
});
