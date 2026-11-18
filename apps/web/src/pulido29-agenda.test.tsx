import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AgendaCobranzasPage } from './ventas/CobranzasPages';

const fila = (terceroId: string, cliente: string) => ({ terceroId, cliente, vencido: '100.00', porVencer: '0.00', aFavor: '0.00', dias: 5, ultimaGestion: null, proximaAccion: null, accionAtrasada: false, promesa: null });

vi.mock('./auth/AuthContext', () => ({ useAuth: () => ({ puede: () => true }) }));
vi.mock('./api/cliente', () => ({
  descargar: vi.fn(),
  api: vi.fn(async (_ruta: string, o?: { query?: { q?: string } }) => ({ clientes: [fila('t1', 'Norte SA'), fila('t2', 'Sur SA')].filter((f) => !o?.query?.q || f.cliente.toLowerCase().includes(o.query.q.toLowerCase())) })),
}));

describe('pulido 29: selección de la agenda', () => {
  it('al buscar se vacía la selección y no se envía a clientes ocultos', async () => {
    render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AgendaCobranzasPage /></MemoryRouter></QueryClientProvider></MantineProvider>);
    fireEvent.click(await screen.findByLabelText('Seleccionar Sur SA'));
    expect(screen.getByRole('button', { name: /Enviar resumen a los seleccionados \(1\)/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'norte' } });
    await screen.findByLabelText('Seleccionar Norte SA');
    expect(screen.queryByLabelText('Seleccionar Sur SA')).toBeNull();
    const boton = screen.getByRole('button', { name: /Enviar resumen a los seleccionados/ }) as HTMLButtonElement;
    expect([boton.textContent, boton.disabled]).toEqual(['Enviar resumen a los seleccionados', true]);
  });
});
