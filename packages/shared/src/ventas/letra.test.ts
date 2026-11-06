import { describe, expect, it } from 'vitest';
import { CondicionIva as C } from '../condicion-iva';
import { letraVenta } from './letra';

describe('letraVenta', () => {
  it('empresa RI', () => {
    expect(letraVenta(C.RESPONSABLE_INSCRIPTO, C.RESPONSABLE_INSCRIPTO)).toBe('A');
    expect(letraVenta(C.RESPONSABLE_INSCRIPTO, C.MONOTRIBUTO)).toBe('A');
    for (const c of [C.EXENTO, C.CONSUMIDOR_FINAL, C.NO_RESPONSABLE]) expect(letraVenta(C.RESPONSABLE_INSCRIPTO, c)).toBe('B');
  });
  it('empresa monotributo o exenta', () => {
    for (const c of Object.values(C)) expect(letraVenta(C.MONOTRIBUTO, c)).toBe('C');
    expect(letraVenta(C.EXENTO, C.RESPONSABLE_INSCRIPTO)).toBe('C');
  });
  it('otra condición no emite', () => {
    expect(() => letraVenta(C.CONSUMIDOR_FINAL, C.RESPONSABLE_INSCRIPTO)).toThrow('La condición de IVA de la empresa no permite emitir comprobantes');
  });
});
