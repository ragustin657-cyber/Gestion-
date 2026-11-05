import { describe, it, expect } from 'vitest';
import { normalizarNumeroComprobante } from './numero';

describe('normalizarNumeroComprobante', () => {
  it('rellena con ceros', () => expect(normalizarNumeroComprobante('1-1234')).toBe('00001-00001234'));
  it('acepta formato completo', () => expect(normalizarNumeroComprobante('0001-00001234')).toBe('00001-00001234'));
  it('rechaza basura y largos excesivos', () => {
    expect(normalizarNumeroComprobante('abc')).toBeNull();
    expect(normalizarNumeroComprobante('123456-1')).toBeNull();
    expect(normalizarNumeroComprobante('1-123456789')).toBeNull();
    expect(normalizarNumeroComprobante('0-1')).toBeNull();
  });
});
