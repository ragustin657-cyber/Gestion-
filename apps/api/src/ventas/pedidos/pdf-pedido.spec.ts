import { renglonesPdf } from './pdf-pedido';

describe('renglones del PDF del pedido', () => {
  const r = [{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', neto: '2000', iva: '420' }];
  it('letra B: precios con IVA incluido, como la factura B', () => {
    expect(renglonesPdf('B', r)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1210', importe: '2420.00' }]);
  });
  it('letra A: precios netos', () => {
    expect(renglonesPdf('A', r)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', importe: '2000' }]);
  });
});
