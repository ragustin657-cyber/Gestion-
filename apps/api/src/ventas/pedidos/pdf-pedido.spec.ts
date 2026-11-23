import { renglonesPdf } from './pdf-pedido';

describe('renglones del PDF del pedido', () => {
  const r = [{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', neto: '2000', iva: '420' }];
  it('letra B: precios con IVA incluido, como la factura B', () => {
    expect(renglonesPdf('B', r)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1210', importe: '2420.00' }]);
  });
  it('letra A: precios netos', () => {
    expect(renglonesPdf('A', r)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', importe: '2000' }]);
  });
  it('E51: con bonificación, el precio es el de lista y va el %', () => {
    const b = [{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', alicuota: '21', bonificacionPct: '10', neto: '1800', iva: '378' }];
    expect(renglonesPdf('B', b)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1210', bonificacion: '10', importe: '2178.00' }]);
    expect(renglonesPdf('A', b)).toEqual([{ descripcion: 'Lámpara', cantidad: '2', precioUnitario: '1000', bonificacion: '10', importe: '1800' }]);
  });
});

