import { describe, it, expect } from 'vitest';
import { lineasEnPesos } from './asiento-pesos';

const centavos = (r: { lado: string; importe: string }[], lado: string) =>
  r.filter((x) => x.lado === lado).reduce((a, x) => a + Math.round(Number(x.importe) * 100), 0);

describe('lineasEnPesos', () => {
  it('USD con redondeo queda balanceado', () => {
    const r = lineasEnPesos([
      { clave: 'gasto', lado: 'DEBE', importe: '100.33' }, { clave: 'iva', lado: 'DEBE', importe: '21.07' },
      { clave: 'prov', lado: 'HABER', importe: '121.40' }], '1450.333');
    expect(centavos(r, 'DEBE')).toBe(centavos(r, 'HABER'));
    expect(r.find((x) => x.clave === 'prov')!.importe).toBe('176070.43');
  });
  it('ajusta el descuadre de redondeo en la línea mayor', () => {
    // 3 × 0.01 a cotización 1.5 → 0.015 c/u → redondea 0.02 ×3 = 0.06; haber 0.03×1.5 = 0.045 → 0.05
    const r = lineasEnPesos([
      { clave: 'a', lado: 'DEBE', importe: '0.01' }, { clave: 'b', lado: 'DEBE', importe: '0.01' }, { clave: 'c', lado: 'DEBE', importe: '0.01' },
      { clave: 'p', lado: 'HABER', importe: '0.03' }], '1.5');
    expect(centavos(r, 'DEBE')).toBe(centavos(r, 'HABER'));
    expect(centavos(r, 'HABER')).toBe(5);
  });
  it('ARS cotización 1 no cambia nada', () => {
    const l = [{ clave: 'g', lado: 'DEBE' as const, importe: '10.00' }, { clave: 'p', lado: 'HABER' as const, importe: '10.00' }];
    expect(lineasEnPesos(l, '1')).toEqual(l);
  });
});
