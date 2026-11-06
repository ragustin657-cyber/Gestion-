import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { EstadoEmision } from './EstadoEmision';
import { GrillaVenta, RenglonVentaEditable, TituloComprobante } from './GrillaVenta';

const mixto: RenglonVentaEditable[] = [
  { articuloId: null, descripcion: 'a', cantidad: '2', precioUnitario: '100,125', alicuota: '21' },
  { articuloId: null, descripcion: 'b', cantidad: '1', precioUnitario: '50', alicuota: '21' },
  { articuloId: null, descripcion: 'c', cantidad: '3', precioUnitario: '33,3333', alicuota: '10.5' },
  { articuloId: null, descripcion: 'd', cantidad: '1', precioUnitario: '10', alicuota: 'EXENTO' },
  { articuloId: null, descripcion: 'e', cantidad: '1', precioUnitario: '5', alicuota: 'NO_GRAVADO' },
];

function Grilla() {
  const [r, setR] = useState<RenglonVentaEditable[]>(mixto.slice(0, 4));
  return <MantineProvider><GrillaVenta renglones={r} onChange={setR} letra="A" moneda="ARS" articulos={[]} /></MantineProvider>;
}

describe('comprobante de venta', () => {
  it('la letra sale de las condiciones de IVA', () => {
    render(<MantineProvider><TituloComprobante tipo="FACTURA" empresa="RESPONSABLE_INSCRIPTO" cliente="RESPONSABLE_INSCRIPTO" /></MantineProvider>);
    expect(screen.getByText('Factura A')).toBeInTheDocument();
    render(<MantineProvider><TituloComprobante tipo="NOTA_CREDITO" empresa="RESPONSABLE_INSCRIPTO" cliente="CONSUMIDOR_FINAL" /></MantineProvider>);
    expect(screen.getByText('Nota de crédito B')).toBeInTheDocument();
  });

  it('calcula los totales en vivo con IVA por alícuota', () => {
    render(<Grilla />);
    expect(screen.getByTestId('total-venta')).toHaveTextContent('Total $ 423,30');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar renglón' }));
    const descripciones = screen.getAllByLabelText('Descripción');
    fireEvent.change(descripciones[4], { target: { value: 'e' } });
    fireEvent.change(screen.getAllByLabelText('Precio unitario')[4], { target: { value: '5' } });
    fireEvent.change(screen.getAllByLabelText('Cantidad')[4], { target: { value: '1' } });
    expect(screen.getByTestId('total-venta')).toHaveTextContent('Total $ 429,35');
    expect(screen.getByText('IVA 21%')).toBeInTheDocument();
  });

  it('un error de ARCA se muestra con el botón Reintentar', () => {
    const reintentar = vi.fn();
    render(<MantineProvider><EstadoEmision comprobante={{ estado: 'PENDIENTE_CAE', ultimoError: 'No se pudo conectar con ARCA: tiempo agotado', cae: null, numero: null, puntoVenta: 1 }} onReintentar={reintentar} /></MantineProvider>);
    expect(screen.getByText(/No se pudo conectar con ARCA/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reintentar).toHaveBeenCalled();
  });
});
