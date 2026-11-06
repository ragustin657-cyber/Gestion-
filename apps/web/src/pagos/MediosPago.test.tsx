import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MedioEditable, MediosPago } from './MediosPago';

const cuentas = [{ id: 'c1', etiqueta: 'Nación 1', monedaCodigo: 'ARS' }];
const props = { cuentas, cajas: [], chequeras: [], cotizacion: '1000', totalACubrir: '118343.40', onChange: () => {} };
const transferencia = (importe: string): MedioEditable => ({ tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe, cuentaBancariaId: 'c1' });

describe('MediosPago', () => {
  it('muestra lo que falta cubrir', () => {
    render(<MantineProvider><MediosPago {...props} medios={[transferencia('100000')]} /></MantineProvider>);
    expect(screen.getByTestId('falta-cubrir')).toHaveTextContent('Falta $ 18.343,40');
  });
  it('cubierto exacto: no muestra faltante', () => {
    render(<MantineProvider><MediosPago {...props} medios={[transferencia('100000'), transferencia('18343.40')]} /></MantineProvider>);
    expect(screen.queryByTestId('falta-cubrir')).toBeNull();
    expect(screen.getByText(/Cubierto: \$ 118.343,40/)).toBeInTheDocument();
  });
  it('un cheque de terceros cuenta por su importe', () => {
    const cheques = [{ id: 'ch1', etiqueta: 'Galicia 123', monedaCodigo: 'ARS', importe: '50000' }];
    const medio: MedioEditable = { tipo: 'CHEQUE_TERCERO', monedaCodigo: 'ARS', importe: '', chequeId: 'ch1' };
    render(<MantineProvider><MediosPago {...props} totalACubrir="50000" chequesCartera={cheques} medios={[medio]} /></MantineProvider>);
    expect(screen.queryByTestId('falta-cubrir')).toBeNull();
    expect(screen.getByText(/Cubierto: \$ 50.000,00/)).toBeInTheDocument();
  });
});
