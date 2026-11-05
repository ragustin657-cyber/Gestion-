import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { ConfigRetencionesPage } from './ConfigRetencionesPage';

describe('ConfigRetencionesPage', () => {
  it('advierte verificar los valores precargados', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const datos = url.includes('/regimenes')
        ? [{ id: 'r1', codigo: '94', descripcion: 'Locaciones de obra y servicios', minimoNoSujeto: '67170', alicuotaInscripto: '2', alicuotaNoInscripto: '28', usaEscala: false, minimoRetencion: '240', activo: true, verificar: true }]
        : url.includes('/escala') || url.includes('/jurisdicciones') ? [] : { montoAprobacionOp: '0' };
      return new Response(JSON.stringify(datos), { status: 200 });
    }));
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><AuthProvider><ConfigRetencionesPage /></AuthProvider></MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText('Verificar valores vigentes')).toBeInTheDocument();
  });
});
