import { describe, expect, it } from 'vitest';
import { montoEnLetras } from './letras';

describe('montoEnLetras', () => {
  it('convierte importes en pesos', () => {
    expect(montoEnLetras('941016.82')).toBe('pesos novecientos cuarenta y un mil dieciséis con 82/100');
    expect(montoEnLetras('1000000')).toBe('pesos un millón con 00/100');
    expect(montoEnLetras('21.5')).toBe('pesos veintiuno con 50/100');
    expect(montoEnLetras('2000001')).toBe('pesos dos millones uno con 00/100');
    expect(montoEnLetras('115100')).toBe('pesos ciento quince mil cien con 00/100');
    expect(montoEnLetras('0.05')).toBe('pesos cero con 05/100');
  });
});
