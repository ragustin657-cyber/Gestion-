import { describe, expect, it } from 'vitest';
import { calcularDespacho, numeroDespachoValido } from './DespachoImportacionPage';

describe('despacho de importación (web, E41)', () => {
  it('IVA por alícuota y total liquidado sin la base', () => {
    const r = calcularDespacho([{ base: '100000', alicuotaIva: '21' }, { base: '50000', alicuotaIva: '10.5' }], { percepcionIva: '3000', percepcionGanancias: '6000', iibb: ['2500'], derechos: '8000', tasa: '2000' });
    expect(r).toEqual({ ivas: [{ alicuota: '21', base: 100000, iva: 21000 }, { alicuota: '10.5', base: 50000, iva: 5250 }], iva: 26250, total: 47750 });
  });

  it('valida el número de despacho', () => {
    expect(numeroDespachoValido('26001IC04012345K')).toBe(true);
    expect(numeroDespachoValido('26001ic04012345k')).toBe(true);
    expect(numeroDespachoValido('123')).toBe(false);
  });
});
