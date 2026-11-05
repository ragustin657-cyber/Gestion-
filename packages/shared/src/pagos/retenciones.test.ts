import { describe, it, expect } from 'vitest';
import { alicuotaIibb, baseSujeta, retencionGanancias, retencionIibb } from './retenciones';

const regimen = { minimoNoSujeto: '100000', alicuotaInscripto: '2', alicuotaNoInscripto: '28', usaEscala: false, minimoRetencion: '240' };
const ESCALA = [
  { desde: '0', hasta: '8000', fijo: '0', porcentaje: '5' }, { desde: '8000', hasta: '16000', fijo: '400', porcentaje: '9' },
  { desde: '16000', hasta: '24000', fijo: '1120', porcentaje: '12' }, { desde: '24000', hasta: '32000', fijo: '2080', porcentaje: '15' },
  { desde: '32000', hasta: '48000', fijo: '3280', porcentaje: '19' }, { desde: '48000', hasta: '64000', fijo: '6320', porcentaje: '23' },
  { desde: '64000', hasta: '96000', fijo: '10000', porcentaje: '27' }, { desde: '96000', hasta: null, fijo: '18640', porcentaje: '31' },
];
const g = (o: Partial<Parameters<typeof retencionGanancias>[0]>) =>
  retencionGanancias({ sujeto: true, inscripto: true, regimen, escala: ESCALA, baseAcumuladaPrevia: '0', basePago: '0', retenidoPrevio: '0', ...o });

describe('retencionGanancias', () => {
  it('debajo del mínimo no retiene', () => expect(g({ basePago: '90000' }).importe).toBe('0.00'));
  it('acumulado que cruza el mínimo', () =>
    expect(g({ baseAcumuladaPrevia: '80000', basePago: '50000' })).toEqual({ importe: '600.00', acumulado: '130000.00', sujetoRetencion: '30000.00', impuestoDeterminado: '600.00' }));
  it('descuenta lo ya retenido y aplica el mínimo de retención', () =>
    expect(g({ baseAcumuladaPrevia: '80000', basePago: '50000', retenidoPrevio: '500' }).importe).toBe('0.00'));
  it('no inscripto', () => expect(g({ inscripto: false, baseAcumuladaPrevia: '80000', basePago: '50000' }).importe).toBe('8400.00'));
  it('escala de honorarios', () =>
    expect(g({ regimen: { ...regimen, minimoNoSujeto: '67170', usaEscala: true }, basePago: '100000' }).importe).toBe('3437.70'));
  it('no sujeto', () => expect(g({ sujeto: false, basePago: '500000' }).importe).toBe('0.00'));
  it('base negativa no retiene', () => expect(g({ baseAcumuladaPrevia: '500000', basePago: '-1000' }).importe).toBe('0.00'));
});

describe('alicuotaIibb', () => {
  const base = { exento: false, padron: null, ficha: null, usaPadron: true, sinPadron: 'NO_RETENER' as const, alicuotaDefecto: '0' };
  it('padrón gana sobre ficha', () => expect(alicuotaIibb({ ...base, padron: '1.75', ficha: '3' })).toBe('1.75'));
  it('sin padrón usa ficha', () => expect(alicuotaIibb({ ...base, ficha: '3' })).toBe('3'));
  it('sin padrón ni ficha y NO_RETENER → null', () => expect(alicuotaIibb(base)).toBeNull());
  it('ALICUOTA_DEFECTO', () => expect(alicuotaIibb({ ...base, sinPadron: 'ALICUOTA_DEFECTO', alicuotaDefecto: '2.5' })).toBe('2.5'));
  it('exento → null', () => expect(alicuotaIibb({ ...base, exento: true, padron: '1.75' })).toBeNull());
  it('si la jurisdicción no usa padrón, lo ignora', () => expect(alicuotaIibb({ ...base, usaPadron: false, padron: '1.75', ficha: '3' })).toBe('3'));
});

describe('retencionIibb y baseSujeta', () => {
  it('mínimo de retención', () => {
    expect(retencionIibb('10000', '1.75', '200')).toBe('0.00');
    expect(retencionIibb('10000', '1.75', '100')).toBe('175.00');
    expect(retencionIibb('-10000', '1.75', '0')).toBe('0.00');
  });
  it('base proporcional sin IVA', () => {
    expect(baseSujeta('1210.00', { netoGravado: '1000', noGravado: '0', exento: '0', total: '1210' })).toBe('1000.00');
    expect(baseSujeta('605.00', { netoGravado: '1000', noGravado: '0', exento: '0', total: '1210' })).toBe('500.00');
    expect(baseSujeta('-1210.00', { netoGravado: '1000', noGravado: '0', exento: '0', total: '1210' })).toBe('-1000.00');
    expect(baseSujeta('1210.00', null)).toBe('1210.00');
  });
});
