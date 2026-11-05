import { describe, it, expect } from 'vitest';
import { calcularTotales, importeRenglon } from './calculos';

describe('importeRenglon', () => {
  it('importe con bonificación', () =>
    expect(importeRenglon({ cantidad: 3, precioUnitario: '100.005', bonificacionPct: 10 })).toBe('270.01'));
  it('rechaza cantidad 0, precio negativo, bonificación 101', () => {
    expect(() => importeRenglon({ cantidad: 0, precioUnitario: 1 })).toThrow('Cantidad inválida');
    expect(() => importeRenglon({ cantidad: 1, precioUnitario: -1 })).toThrow('Precio inválido');
    expect(() => importeRenglon({ cantidad: 1, precioUnitario: 1, bonificacionPct: 101 })).toThrow('Bonificación inválida');
  });
  it('rechaza texto no numérico', () => expect(() => importeRenglon({ cantidad: 'abc', precioUnitario: 1 })).toThrow('Cantidad inválida'));
});

describe('calcularTotales', () => {
  it('factura A con dos alícuotas y percepciones', () => {
    const t = calcularTotales({
      discriminaIva: true,
      renglones: [{ importe: '1000.00', alicuotaIva: 21 }, { importe: '500.00', alicuotaIva: 10.5 }, { importe: '333.33', alicuotaIva: 21 }],
      percepcionIva: '30.00', percepcionesIibb: ['15.50', '4.50'], impuestosInternos: '0', noGravado: '10', exento: '0',
    });
    expect(t.ivaPorAlicuota).toEqual([
      { alicuota: '10.5', base: '500.00', importe: '52.50' },
      { alicuota: '21', base: '1333.33', importe: '280.00' },
    ]);
    expect(t).toMatchObject({ netoGravado: '1833.33', iva: '332.50', percepciones: '50.00', total: '2225.83' });
  });
  it('factura C no discrimina IVA', () => {
    const t = calcularTotales({ discriminaIva: false, renglones: [{ importe: '1210.00', alicuotaIva: 21 }] });
    expect(t).toMatchObject({ iva: '0.00', total: '1210.00', ivaPorAlicuota: [] });
  });
});
