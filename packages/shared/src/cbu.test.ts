import { describe, it, expect } from 'vitest';
import { validarCbu } from './cbu';

// Fixture generado con el algoritmo BCRA: bloque 1 = 011 0599 + dv 5; bloque 2 = 0000000123456 + dv 5
const VALIDO = '0110599500000001234565';

describe('cbu', () => {
  it('acepta CBU válido', () => expect(validarCbu(VALIDO)).toBe(true));
  it('acepta con espacios', () => expect(validarCbu('01105995 00000001234565')).toBe(true));
  it('rechaza dígito verificador del bloque 1 alterado', () =>
    expect(validarCbu('0110599400000001234565')).toBe(false));
  it('rechaza dígito verificador del bloque 2 alterado', () =>
    expect(validarCbu('0110599500000001234564')).toBe(false));
  it('rechaza largo incorrecto', () => expect(validarCbu('011059950000000123456')).toBe(false));
});
