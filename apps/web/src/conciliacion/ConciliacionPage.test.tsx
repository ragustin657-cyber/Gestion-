import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { ConciliacionPage } from './ConciliacionPage';

const conciliacion = (diferencia: string) => ({
  id: 'c1', cuentaBancariaId: 'cb1', desde: '2026-10-01T00:00:00.000Z', hasta: '2026-10-31T00:00:00.000Z', saldoInicial: '0', saldoFinal: '52682',
  estado: 'ABIERTA', version: 0,
  resumen: { saldoSistema: '51800', pendientesSistema: '-1200', pendientesExtracto: '-318', diferencia, lineasPendientes: 0, advertencia: null },
  lineas: [{ id: 'l1', fecha: '2026-10-15T00:00:00.000Z', concepto: 'IMP LEY 25413', referencia: null, importe: '-318', estado: 'PENDIENTE', reglaSugerida: { id: 'r1', cuentaContableId: 'cc1', cuenta: '5.2.05 Impuesto', concepto: 'IMP LEY 25413' } }],
  movimientos: [{ id: 'm1', fecha: '2026-10-20', tipo: 'EGRESO', origenTipo: 'MOVIMIENTO_BANCARIO', origenId: 'o1', descripcion: 'Movimiento bancario', referencia: '1', importe: '-1200' }],
  vinculos: [],
});

function montar(diferencia: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/conciliaciones/c1') ? conciliacion(diferencia) : []), { status: 200 })));
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AuthProvider><ConciliacionPage idInicial="c1" /></AuthProvider></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('ConciliacionPage', () => {
  it('diferencia cero: en verde y con el cierre habilitado', async () => {
    montar('0');
    expect(await screen.findByTestId('diferencia')).toHaveTextContent('$ 0,00');
    expect(screen.getByTestId('diferencia')).toHaveAttribute('data-cuadra', 'si');
    expect(screen.getByRole('button', { name: 'Cerrar conciliación' })).toBeEnabled();
    expect(screen.getByText('5.2.05 Impuesto')).toBeInTheDocument();
  });
  it('con diferencia: en rojo y sin poder cerrar', async () => {
    montar('-682');
    expect(await screen.findByTestId('diferencia')).toHaveTextContent('-$ 682,00');
    expect(screen.getByTestId('diferencia')).toHaveAttribute('data-cuadra', 'no');
    expect(screen.getByRole('button', { name: 'Cerrar conciliación' })).toBeDisabled();
  });
});
