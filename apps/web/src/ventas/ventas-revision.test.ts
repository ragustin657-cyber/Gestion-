import { aplicarPrecioSugerido } from './GrillaVenta';
import { renglonDesdeComprobante } from './ComprobanteVentaPage';
import { convertirPrecio, cuerpoAumento } from './precios';

describe('ventas completas: correcciones de la revisión (web)', () => {
  it('al recargar un borrador se conservan los vínculos con remitos y pedidos', () => {
    const base = { articuloId: 'a', descripcion: 'Lámpara', cantidad: '20', precioUnitario: '2500', alicuota: '21' };
    expect(renglonDesdeComprobante({ ...base, remitoRenglonId: 'rr', pedidoRenglonId: 'pr' })).toMatchObject({ origen: 'REMITO', remitoRenglonId: 'rr', pedidoRenglonId: 'pr', etiqueta: 'Desde remito', cantidad: '20' });
    expect(renglonDesdeComprobante({ ...base, remitoRenglonId: null, pedidoRenglonId: 'pr' })).toMatchObject({ origen: 'PEDIDO', pedidoRenglonId: 'pr', etiqueta: 'Desde pedido' });
    expect(renglonDesdeComprobante({ ...base, remitoRenglonId: null, pedidoRenglonId: null }).origen).toBe('DIRECTO');
  });

  it('convierte el precio del pedido a la moneda de la factura', () => {
    expect(convertirPrecio('20', 'USD', 'ARS', '1250', '1000')).toBe('25000');
    expect(convertirPrecio('20', 'USD', 'ARS', '', '1000')).toBe('20000');
    expect(convertirPrecio('2500', 'ARS', 'USD', '1250', '1')).toBe('2');
    expect(convertirPrecio('2500', 'ARS', 'ARS', '', '1')).toBe('2500');
  });

  it('el aumento respeta el alcance elegido', () => {
    expect(cuerpoAumento(10, '1', 'todos', ['a', 'b'])).toEqual({ porcentaje: 10, redondeo: '1' });
    expect(cuerpoAumento(10, '1', 'filtrados', ['a', 'b'])).toEqual({ porcentaje: 10, redondeo: '1', articuloIds: ['a', 'b'] });
  });

  it('el precio sugerido no pisa cambios hechos mientras llegaba', () => {
    const r = [{ articuloId: 'a', descripcion: 'A', cantidad: '7', precioUnitario: '', alicuota: '21' }, { articuloId: 'b', descripcion: 'B', cantidad: '1', precioUnitario: '', alicuota: '21' }];
    expect(aplicarPrecioSugerido(r, 0, 'a', '2500')[0]).toMatchObject({ cantidad: '7', precioUnitario: '2500' });
    expect(aplicarPrecioSugerido(r, 0, 'x', '2500')).toBe(r);
    expect(aplicarPrecioSugerido([{ ...r[0], precioUnitario: '999' }], 0, 'a', '2500')[0].precioUnitario).toBe('999');
  });
});
