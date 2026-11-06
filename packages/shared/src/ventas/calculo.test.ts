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
});
