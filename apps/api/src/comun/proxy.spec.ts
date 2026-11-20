import { confianzaProxy } from './proxy';

describe('TRUST_PROXY (E36)', () => {
  it('interpreta los valores', () => {
    expect(confianzaProxy(undefined)).toBeUndefined();
    expect(confianzaProxy('')).toBeUndefined();
    expect(confianzaProxy('0')).toBeUndefined();
    expect(confianzaProxy('false')).toBeUndefined();
    expect(confianzaProxy('true')).toBe(1);
    expect(confianzaProxy('1')).toBe(1);
    expect(confianzaProxy('2')).toBe(2);
    expect(confianzaProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});
