import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { GrillaRenglones, RenglonEditable } from './GrillaRenglones';

const renglones: RenglonEditable[] = [
  { descripcion: 'Tornillos', cantidad: '2', precioUnitario: '1000', bonificacionPct: '0', alicuotaIva: '21' },
  { descripcion: 'Yerba', cantidad: '1', precioUnitario: '500', bonificacionPct: '0', alicuotaIva: '10.5' },
];
const envolver = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>);

describe('GrillaRenglones', () => {
  it('muestra el total con IVA', () => {
    envolver(<GrillaRenglones renglones={renglones} onChange={() => {}} discriminaIva articulos={[]} centrosCosto={[]} />);
    expect(screen.getByTestId('total-comprobante')).toHaveTextContent('$ 2.972,50');
  });

  it('al editar la cantidad avisa el cambio', () => {
    const onChange = vi.fn();
    envolver(<GrillaRenglones renglones={renglones} onChange={onChange} discriminaIva articulos={[]} centrosCosto={[]} />);
    fireEvent.change(screen.getAllByLabelText('Cantidad')[0], { target: { value: '3' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0][0].cantidad).toBe('3');
  });

  it('con valores inválidos muestra guion sin romper', () => {
    envolver(<GrillaRenglones renglones={[{ ...renglones[0], cantidad: 'abc' }]} onChange={() => {}} discriminaIva articulos={[]} centrosCosto={[]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
