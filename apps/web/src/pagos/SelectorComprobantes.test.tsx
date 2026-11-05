import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Pendiente, SelectorComprobantes, SeleccionImputaciones } from './SelectorComprobantes';

const pendientes: Pendiente[] = [
  { movimientoId: 'a', comprobante: 'FC A 00001-00000001', fecha: '2026-11-01', fechaVencimiento: '2026-12-01', monedaCodigo: 'ARS', saldo: '1210', comprometido: '0', disponible: '1210' },
  { movimientoId: 'b', comprobante: 'FC A 00001-00000002', fecha: '2026-11-01', fechaVencimiento: '2026-12-01', monedaCodigo: 'USD', saldo: '100', comprometido: '0', disponible: '100' },
];

function Prueba() {
  const [s, setS] = useState<SeleccionImputaciones>({});
  return <SelectorComprobantes pendientes={pendientes} seleccion={s} onChange={setS} cotizacion="1100" />;
}

describe('SelectorComprobantes', () => {
  it('suma en pesos con la cotización y avisa si se supera el disponible', async () => {
    render(<MantineProvider><Prueba /></MantineProvider>);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }));
    expect(screen.getByTestId('total-cancelar')).toHaveTextContent('$ 111.210,00');
    fireEvent.change(screen.getAllByLabelText('Importe a cancelar')[0], { target: { value: '2000' } });
    expect(screen.getByText('Supera el disponible')).toBeInTheDocument();
  });
});
