import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { GrillaAsiento, RenglonEditable } from './GrillaAsiento';

const cuentas = [{ value: 'c1', label: '5.2.01 Gastos generales' }, { value: 'c2', label: '1.1.01.001 Caja' }];

function Prueba() {
  const [r, setR] = useState<RenglonEditable[]>([
    { cuentaContableId: 'c1', centroCostoId: null, debe: '100', haber: '', detalle: '' },
    { cuentaContableId: 'c2', centroCostoId: null, debe: '', haber: '90', detalle: '' },
  ]);
  return <MantineProvider><GrillaAsiento renglones={r} onChange={setR} cuentas={cuentas} centros={[]} onRegistrar={() => undefined} /></MantineProvider>;
}

describe('GrillaAsiento', () => {
  it('muestra la diferencia y habilita el registro cuando balancea', () => {
    render(<Prueba />);
    expect(screen.getByTestId('diferencia-asiento')).toHaveTextContent('Diferencia $ 10,00');
    expect(screen.getByRole('button', { name: 'Registrar asiento' })).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Haber')[1], { target: { value: '100' } });
    expect(screen.queryByTestId('diferencia-asiento')).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrar asiento' })).toBeEnabled();
  });
});
