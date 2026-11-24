import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExistenciasPage } from './ExistenciasPage';

describe('reservas de stock (web, E53)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('existencias muestra reservado y disponible, y el modal lista los pedidos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes('/stock/reservas')
        ? [{ pedidoId: 'p', pedido: 12, fecha: '2026-11-02', cliente: 'Distribuidora Norte SA', depositoId: 'd', deposito: 'Central', articuloId: 'a', codigo: 'ART-1', cantidad: '8' }]
        : u.includes('/stock/existencias')
          ? { filas: [{ articuloId: 'a', codigo: 'ART-1', descripcion: 'Uno', unidad: 'UN', depositos: [{ depositoId: 'd', nombre: 'Central', cantidad: '10', reservado: '8', disponible: '2' }], cantidad: '10', costoPromedio: '100', valor: '1000.00', reservado: '8', disponible: '2' }], total: '1000.00' }
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><ExistenciasPage /></MemoryRouter></QueryClientProvider></MantineProvider>);
    expect(await screen.findByText('Reservado')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Reservas de ART-1' }));
    expect(await screen.findByText('Distribuidora Norte SA')).toBeInTheDocument();
    expect(screen.getByText('Pedido 12')).toBeInTheDocument();
  });
});
