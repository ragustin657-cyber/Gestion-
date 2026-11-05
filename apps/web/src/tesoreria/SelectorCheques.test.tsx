import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChequeFila, SelectorCheques } from './SelectorCheques';

const cheques: ChequeFila[] = [
  { id: 'a', banco: 'Galicia', numero: '1', libradorNombre: 'Uno SA', fechaPago: '2026-12-01', monedaCodigo: 'ARS', importe: '50000' },
  { id: 'b', banco: 'Nación', numero: '2', libradorNombre: 'Dos SA', fechaPago: '2026-12-10', monedaCodigo: 'ARS', importe: '30000' },
];

function Prueba({ multiple = true }: { multiple?: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  return <MantineProvider><SelectorCheques cheques={cheques} seleccion={sel} onChange={setSel} multiple={multiple} /></MantineProvider>;
}

describe('SelectorCheques', () => {
  it('suma los cheques seleccionados', () => {
    render(<Prueba />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cheque 1 Galicia' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cheque 2 Nación' }));
    expect(screen.getByTestId('total-seleccionado')).toHaveTextContent('Total seleccionado: $ 80.000,00');
  });
  it('en modo simple solo queda uno', () => {
    render(<Prueba multiple={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Cheque 1 Galicia' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Cheque 2 Nación' }));
    expect(screen.getByTestId('total-seleccionado')).toHaveTextContent('Total seleccionado: $ 30.000,00');
  });
});
