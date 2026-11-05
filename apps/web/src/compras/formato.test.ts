import { formatoFecha, formatoMoneda, formatoNumero } from './formato';

describe('formato', () => {
  it('moneda', () => {
    expect(formatoMoneda('1234.5')).toBe('$ 1.234,50');
    expect(formatoMoneda('10', 'USD')).toBe('US$ 10,00');
    expect(formatoMoneda('-1210')).toBe('-$ 1.210,00');
  });
  it('fecha', () => {
    expect(formatoFecha('2026-11-05')).toBe('05/11/2026');
    expect(formatoFecha('2026-11-05T00:00:00.000Z')).toBe('05/11/2026');
    expect(formatoFecha(null)).toBe('');
  });
  it('número de comprobante', () => expect(formatoNumero(1, 1234)).toBe('00001-00001234'));
});
