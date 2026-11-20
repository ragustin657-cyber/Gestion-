import { describe, expect, it } from 'vitest';
import { percepcionesIva, percepcionIibb, revertirPercepcion } from './percepciones';

describe('percepciones en ventas (E39)', () => {
  it('IIBB: base × alícuota', () => {
    expect(percepcionIibb({ base: '10000', alicuota: '3', minimoPesos: '0', cotizacion: '1' })).toBe('300.00');
  });
  it('IIBB: bajo el mínimo en pesos no se percibe', () => {
    expect(percepcionIibb({ base: '1000', alicuota: '3', minimoPesos: '50', cotizacion: '1' })).toBe('0.00');
  });
  it('IIBB: en dólares el mínimo se compara en pesos', () => {
    expect(percepcionIibb({ base: '100', alicuota: '3', minimoPesos: '2000', cotizacion: '1000' })).toBe('3.00');
    expect(percepcionIibb({ base: '100', alicuota: '3', minimoPesos: '4000', cotizacion: '1000' })).toBe('0.00');
  });
  it('IIBB: sin alícuota o base no positiva', () => {
    expect(percepcionIibb({ base: '1000', alicuota: null, minimoPesos: '0', cotizacion: '1' })).toBe('0.00');
    expect(percepcionIibb({ base: '0', alicuota: '3', minimoPesos: '0', cotizacion: '1' })).toBe('0.00');
  });

  const iva = { alicuotaGeneral: '3', alicuotaReducida: '1.5', minimoNetoPesos: '0', cotizacion: '1', exclusionPct: null };
  it('IVA: tramo general y reducido', () => {
    expect(percepcionesIva({ ...iva, netoPorAlicuota: { '21': '10000', '10.5': '2000' } })).toEqual([
      { tramo: 'GENERAL', base: '10000.00', alicuota: '3', importe: '300.00' },
      { tramo: 'REDUCIDA', base: '2000.00', alicuota: '1.5', importe: '30.00' },
    ]);
  });
  it('IVA: 27 % va al general y 5 / 2,5 % al reducido', () => {
    const r = percepcionesIva({ ...iva, netoPorAlicuota: { '27': '1000', '5': '1000', '2.5': '1000', '0': '500' } });
    expect(r.map((x) => [x.tramo, x.base])).toEqual([['GENERAL', '1000.00'], ['REDUCIDA', '2000.00']]);
  });
  it('IVA: neto bajo el mínimo → nada', () => {
    expect(percepcionesIva({ ...iva, minimoNetoPesos: '20000', netoPorAlicuota: { '21': '10000' } })).toEqual([]);
  });
  it('IVA: la exclusión parcial reduce el importe', () => {
    const r = percepcionesIva({ ...iva, exclusionPct: 50, netoPorAlicuota: { '21': '10000', '10.5': '2000' } });
    expect(r.map((x) => x.importe)).toEqual(['150.00', '15.00']);
  });
  it('IVA: exclusión total o solo alícuota 0 → nada', () => {
    expect(percepcionesIva({ ...iva, exclusionPct: 100, netoPorAlicuota: { '21': '10000' } })).toEqual([]);
    expect(percepcionesIva({ ...iva, netoPorAlicuota: { '0': '10000' } })).toEqual([]);
  });

  it('reversión proporcional con tope en lo percibido', () => {
    expect(revertirPercepcion({ baseNc: '5000', alicuota: '3', exclusionPct: null, percibido: '300', yaRevertido: '0' })).toBe('150.00');
    expect(revertirPercepcion({ baseNc: '6000', alicuota: '3', exclusionPct: null, percibido: '300', yaRevertido: '150' })).toBe('150.00');
    expect(revertirPercepcion({ baseNc: '1000', alicuota: '3', exclusionPct: null, percibido: '300', yaRevertido: '300' })).toBe('0.00');
    expect(revertirPercepcion({ baseNc: '1000', alicuota: '3', exclusionPct: 50, percibido: '300', yaRevertido: '0' })).toBe('15.00');
  });
});
