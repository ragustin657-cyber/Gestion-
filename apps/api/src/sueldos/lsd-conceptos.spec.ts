import { CONCEPTOS_COMERCIO } from './modelo';
import { codigoArcaPorDefecto, RENGLONES_FIJOS, validarCodigoArca } from './lsd-conceptos';

describe('LSD: códigos ARCA', () => {
  it('por defecto de la precarga', () => {
    const r = Object.fromEntries(CONCEPTOS_COMERCIO.map((c) => [c.codigo, codigoArcaPorDefecto({ ...c, destino: c.destino ?? 'OTRO' })]));
    expect(r).toEqual({ 100: '110000', 110: '160001', 120: '170001', 130: '130001', 131: '130002', 140: '110000', 150: '150000', 151: '110000', 210: '550000', 500: '810000', 510: '810001', 520: '810002', 530: '810004', 540: '810004', 560: '810008' });
  });

  it('por defecto genéricos', () => {
    expect(codigoArcaPorDefecto({ codigo: '900', clase: 'REMUNERATIVO', tipo: 'FIJO', parametros: {}, destino: 'OTRO' })).toBe('160000');
    expect(codigoArcaPorDefecto({ codigo: '901', clase: 'DESCUENTO', tipo: 'FIJO', parametros: {}, destino: 'OTRO' })).toBe('820000');
    expect(codigoArcaPorDefecto({ codigo: '902', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: {}, destino: 'OTRO' })).toBe('550000');
  });

  it('validación del rango', () => {
    expect(validarCodigoArca('810000', 'REMUNERATIVO')).toBe('El código ARCA 810000 no corresponde a un concepto remunerativo');
    expect(validarCodigoArca('110000', 'NO_REMUNERATIVO')).toBe('El código ARCA 110000 no corresponde a un concepto no remunerativo');
    expect(validarCodigoArca('520000', 'DESCUENTO')).toBe('El código ARCA 520000 no corresponde a un concepto descuento');
    expect(validarCodigoArca('820000', 'DESCUENTO')).toBeNull();
    expect(validarCodigoArca('12345A', 'REMUNERATIVO')).toBe('El código ARCA 12345A no corresponde a un concepto remunerativo');
  });

  it('renglones fijos', () => {
    expect(RENGLONES_FIJOS.map((r) => [r.codigo, r.codigoArca])).toEqual([['200', '120000'], ['201', '120003'], ['300', '520014'], ['310', '520015'], ['311', '520017'], ['320', '520016'], ['321', '520017'], ['330', '520012'], ['331', '520018'], ['340', '520010']]);
  });
});
