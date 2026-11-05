import { describe, it, expect } from 'vitest';
import { CondicionIva } from '../condicion-iva';
import { discriminaIva, letrasValidas } from './letras';

describe('letrasValidas', () => {
  it.each([
    ['RESPONSABLE_INSCRIPTO', 'RESPONSABLE_INSCRIPTO', ['A', 'M']],
    ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', ['C']],
    ['RESPONSABLE_INSCRIPTO', 'EXENTO', ['B', 'C']],
    ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', ['B']],
    ['EXENTO', 'MONOTRIBUTO', ['C']],
    ['RESPONSABLE_INSCRIPTO', 'CONSUMIDOR_FINAL', []],
  ])('%s recibe de %s: %j', (e, p, l) => expect(letrasValidas(e as CondicionIva, p as CondicionIva)).toEqual(l));
  it('discrimina IVA solo A y M', () => {
    expect(discriminaIva('A')).toBe(true);
    expect(discriminaIva('M')).toBe(true);
    expect(discriminaIva('B')).toBe(false);
    expect(discriminaIva(null)).toBe(false);
  });
});
