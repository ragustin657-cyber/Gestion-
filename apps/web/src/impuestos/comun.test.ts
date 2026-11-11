import { cuerpoGenerar } from './comun';

describe('cuerpo de la generación', () => {
  it('la quincena solo viaja donde corresponde', () => {
    expect(cuerpoGenerar('SICORE', '2026', '11', '2')).toEqual({ tipo: 'SICORE', periodo: '202611', quincena: null });
    expect(cuerpoGenerar('SICORE', '2026', '11', '1')).toEqual({ tipo: 'SICORE', periodo: '202611', quincena: 1 });
    expect(cuerpoGenerar('ARBA', '2026', '11', '2')).toEqual({ tipo: 'ARBA', periodo: '202611', quincena: 2 });
    expect(cuerpoGenerar('AGIP', '2026', '11', '1')).toEqual({ tipo: 'AGIP', periodo: '202611', quincena: null });
  });
});
