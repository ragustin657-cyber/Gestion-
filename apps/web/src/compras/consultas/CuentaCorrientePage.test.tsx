import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthContext';
import { CuentaCorrientePage } from './CuentaCorrientePage';

const respuesta = {
  tercero: { id: 'p1', razonSocial: 'Proveedor Uno', cuit: '30700123452' },
  movimientos: [
    { id: 'm1', origenId: 'c1', fecha: '2026-11-07', fechaVencimiento: '2026-12-07', comprobante: 'FC A 00001-00000010', monedaCodigo: 'ARS', importe: '4840.00', importePesos: '4840.00', saldo: '4840.00', saldoPesos: '4840.00', acumuladoPesos: '4840.00' },
    { id: 'm2', origenId: 'c2', fecha: '2026-11-08', fechaVencimiento: '2026-12-08', comprobante: 'NC A 00001-00000011', monedaCodigo: 'ARS', importe: '-1210.00', importePesos: '-1210.00', saldo: '-1210.00', saldoPesos: '-1210.00', acumuladoPesos: '3630.00' },
  ],
  saldos: { ARS: '3630.00', USD: '0.00', pesos: '3630.00' },
};

describe('CuentaCorrientePage', () => {
  it('muestra el saldo y el acumulado por fila', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('/cuenta-corriente/') ? respuesta : { items: [{ id: 'p1', razonSocial: 'Proveedor Uno' }], total: 1 }), { status: 200 })));
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><AuthProvider><CuentaCorrientePage terceroIdInicial="p1" /></AuthProvider></MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByTestId('saldo-pesos')).toHaveTextContent('$ 3.630,00');
    expect(screen.getAllByText('$ 4.840,00').length).toBeGreaterThan(0);
    expect(screen.getByText('NC A 00001-00000011')).toBeInTheDocument();
  });
});
