import { describe, it, expect } from 'vitest';
import { validarCuit, formatearCuit, normalizarCuit } from './cuit';

describe('cuit', () => {
  it('acepta CUIT válido en cualquier formato', () => {
    for (const s of ['20-12345678-6', '20 12345678 6', '20123456786', '30-71234567-1'])
      expect(validarCuit(s)).toBe(true);
  });
  it('rechaza dígito verificador incorrecto', () => expect(validarCuit('20-12345678-5')).toBe(false));
  it('rechaza cuando el verificador calculado es 10', () => {
    for (let d = 0; d <= 9; d++) expect(validarCuit(`2012345676${d}`)).toBe(false);
  });
  it('rechaza largo o prefijo inválido', () => {
    expect(validarCuit('2012345678')).toBe(false);
    expect(validarCuit('99-12345678-6')).toBe(false);
    expect(validarCuit('')).toBe(false);
  });
  it('formatea', () => expect(formatearCuit('20123456786')).toBe('20-12345678-6'));
  it('normaliza', () => expect(normalizarCuit(' 20-12345678-6 ')).toBe('20123456786'));
});
