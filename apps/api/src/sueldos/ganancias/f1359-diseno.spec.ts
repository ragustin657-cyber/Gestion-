import { linea } from '../lsd-diseno';
import { ALICUOTAS_F1359 } from './f1359-datos';
import { F1359_01, F1359_02, F1359_03, F1359_04, F1359_05, F1359_06, F1359_07, F1359_08 } from './f1359-diseno';

const largo = (c: { largo: number }[]) => c.reduce((s, x) => s + x.largo, 0);

describe('F.1359 v2.0: diseño de registro', () => {
  it('largos', () => {
    expect([F1359_01, F1359_02, F1359_03, F1359_04, F1359_05, F1359_06, F1359_07, F1359_08].map(largo)).toEqual([38, 36, 178, 313, 478, 160, 178, 105]);
  });

  it('cabecera', () => {
    expect(linea(F1359_01, { cuit: '30712345671', periodo: '202500', tipo: 1 })).toBe('01307123456712025000001035931359100200');
  });

  it('alícuota y signo', () => {
    expect(ALICUOTAS_F1359['15']).toBe('04');
    expect(linea([{ nombre: 'Saldo', largo: 15, tipo: 'IS', valor: () => '-12345.67' }], {})).toBe('-00000001234567');
    expect(linea([{ nombre: 'Saldo', largo: 15, tipo: 'IS', valor: () => '12345.67' }], {})).toBe('000000001234567');
  });
});
