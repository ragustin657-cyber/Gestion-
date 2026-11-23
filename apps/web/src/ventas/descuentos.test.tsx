import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { GrillaVenta, cuerpoRenglonVenta, renglonVacio } from './GrillaVenta';
import { renglonDePedido } from './ComprobanteVentaPage';

describe('descuentos y bonificaciones (web, E51)', () => {
  it('la grilla tiene % de bonificación y suma con el descuento general', () => {
    render(<MantineProvider><GrillaVenta renglones={[{ ...renglonVacio(), descripcion: 'Producto', cantidad: '2', precioUnitario: '1000', bonificacionPct: '10' }]} onChange={() => {}} letra="A" moneda="ARS" articulos={[]}
      descuentoPct="5" onDescuento={() => {}} /></MantineProvider>);
    expect(screen.getByLabelText('Bonificación %')).toHaveValue('10');
    expect(screen.getByLabelText('Descuento general (%)')).toHaveValue('5');
    expect(screen.getByTestId('total-venta')).toHaveTextContent('Total $ 2.069,10');
    expect(screen.getByText('Descuento general 5 %')).toBeInTheDocument();
  });

  it('el cuerpo del renglón lleva la bonificación', () => {
    expect(cuerpoRenglonVenta({ ...renglonVacio(), descripcion: 'X', cantidad: '1', precioUnitario: '100', bonificacionPct: '12,5' })).toMatchObject({ bonificacionPct: 12.5, precioUnitario: 100 });
    expect(cuerpoRenglonVenta({ ...renglonVacio(), descripcion: 'X', cantidad: '1', precioUnitario: '100' }).bonificacionPct).toBe(0);
  });

  it('el renglón de un pedido trae su bonificación', () => {
    const r = renglonDePedido({ pedidoRenglonId: 'p', numero: 'Pedido 1', articuloId: null, descripcion: 'X', pendiente: '2', precioUnitario: '100', alicuota: '21', bonificacionPct: '15', monedaPedido: 'ARS', cotizacionPedido: '1' }, '2', 'ARS', '');
    expect([r.bonificacionPct, r.precioUnitario, r.origen]).toEqual(['15', '100', 'PEDIDO']);
  });

  it('revisión: cambiar solo la bonificación o el descuento marca las percepciones como desactualizadas', async () => {
    const { renglonesCambiaron } = await import('./ComprobanteVentaPage');
    const guardado = { renglones: [{ articuloId: null, descripcion: 'X', cantidad: '1', precioUnitario: '100', alicuota: '21', bonificacionPct: '0' }], descuentoPct: '0' } as never;
    const r = { ...renglonVacio(), descripcion: 'X', cantidad: '1', precioUnitario: '100' };
    expect(renglonesCambiaron([r], guardado)).toBe(false);
    expect(renglonesCambiaron([{ ...r, bonificacionPct: '10' }], guardado)).toBe(true);
    expect(renglonesCambiaron([r], guardado, '5')).toBe(true);
  });
});

