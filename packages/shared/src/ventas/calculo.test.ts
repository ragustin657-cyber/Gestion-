import { describe, expect, it } from 'vitest';
import { calcularVenta, RenglonCalculo } from './calculo';

const mixto: RenglonCalculo[] = [
  { cantidad: '2', precioUnitario: '100.1250', alicuota: 21 },
  { cantidad: '1', precioUnitario: '50', alicuota: 21 },
  { cantidad: '3', precioUnitario: '33.3333', alicuota: 10.5 },
  { cantidad: '1', precioUnitario: '10', alicuota: 'EXENTO' },
  { cantidad: '1', precioUnitario: '5', alicuota: 'NO_GRAVADO' },
];

describe('calcularVenta', () => {
  it('mezcla de alícuotas, IVA redondeado sobre la base de cada alícuota', () => {
    const r = calcularVenta(mixto, 'A');
    expect(r.renglones.map((x) => x.neto)).toEqual(['200.25', '50.00', '100.00', '10.00', '5.00']);
    expect(r.ivas).toEqual([{ alicuota: 21, base: '250.25', importe: '52.55' }, { alicuota: 10.5, base: '100.00', importe: '10.50' }]);
    expect(r).toMatchObject({ netoGravado: '350.25', exento: '10.00', noGravado: '5.00', iva: '63.05', total: '428.30' });
  });
  it('letra C no discrimina IVA', () => {
    const r = calcularVenta(mixto.slice(0, 3), 'C');
    expect(r.iva).toBe('0.00');
    expect(r.ivas).toEqual([]);
    expect(r.netoGravado).toBe(r.total);
    expect(r.total).toBe('350.25');
  });

  describe('bonificación y descuento general (E51)', () => {
    it('sin bonificación ni descuento: igual que hoy; subtotal = netos', () => {
      const r = calcularVenta(mixto, 'A');
      expect(r.renglones.map((x) => x.importe)).toEqual(['200.25', '50.00', '100.00', '10.00', '5.00']);
      expect([r.subtotal, r.descuentoGeneral]).toEqual(['365.25', '0.00']);
    });
    it('bonificación por renglón', () => {
      const r = calcularVenta([{ cantidad: '2', precioUnitario: '1000', alicuota: 21, bonificacionPct: '10' }], 'A');
      expect([r.renglones[0].neto, r.renglones[0].importe, r.iva, r.total]).toEqual(['1800.00', '1800.00', '378.00', '2178.00']);
    });
    it('bonificación y descuento general: neto redondeado una vez', () => {
      const r = calcularVenta([{ cantidad: '3', precioUnitario: '333.33', alicuota: 21, bonificacionPct: '15' }], 'A', '5');
      expect([r.renglones[0].neto, r.renglones[0].importe, r.subtotal, r.descuentoGeneral]).toEqual(['807.49', '849.99', '849.99', '42.50']);
    });
    it('dos alícuotas con descuento general: IVA sobre los netos descontados', () => {
      const r = calcularVenta([{ cantidad: '1', precioUnitario: '1000', alicuota: 21 }, { cantidad: '1', precioUnitario: '500', alicuota: 10.5 }], 'A', '10');
      expect(r.ivas).toEqual([{ alicuota: 21, base: '900.00', importe: '189.00' }, { alicuota: 10.5, base: '450.00', importe: '47.25' }]);
      expect([r.subtotal, r.descuentoGeneral, r.total]).toEqual(['1500.00', '150.00', '1586.25']);
    });
    it('bonificación 100 % y letra C', () => {
      const r = calcularVenta([{ cantidad: '1', precioUnitario: '1000', alicuota: 21, bonificacionPct: '100' }, { cantidad: '2', precioUnitario: '1000', alicuota: 21, bonificacionPct: '10' }], 'C', '5');
      expect(r.renglones.map((x) => x.neto)).toEqual(['0.00', '1710.00']);
      expect([r.netoGravado, r.total, r.iva]).toEqual(['1710.00', '1710.00', '0.00']);
    });
  });
});

