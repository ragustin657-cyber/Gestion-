import { cuerpoGenerar, quincenasPara } from './comun';

describe('cuerpo de la generación', () => {
  it('la quincena solo viaja donde corresponde', () => {
    expect(cuerpoGenerar('SICORE', '2026', '11', '2')).toEqual({ tipo: 'SICORE', periodo: '202611', quincena: null });
    expect(cuerpoGenerar('SICORE', '2026', '11', '1')).toEqual({ tipo: 'SICORE', periodo: '202611', quincena: 1 });
    expect(cuerpoGenerar('ARBA', '2026', '11', '2')).toEqual({ tipo: 'ARBA', periodo: '202611', quincena: 2 });
    expect(cuerpoGenerar('AGIP', '2026', '11', '1')).toEqual({ tipo: 'AGIP', periodo: '202611', quincena: null });
  });
});

describe('opciones de quincena', () => {
  it('según el impuesto y la periodicidad de ARBA', () => {
    expect(quincenasPara('SICORE', 'MENSUAL').map((o) => o.value)).toEqual(['0', '1']);
    expect(quincenasPara('ARBA', 'MENSUAL').map((o) => o.value)).toEqual([]);
    expect(quincenasPara('ARBA', 'QUINCENAL').map((o) => o.value)).toEqual(['1', '2']);
    expect(quincenasPara('AGIP', 'QUINCENAL')).toEqual([]);
  });
});
