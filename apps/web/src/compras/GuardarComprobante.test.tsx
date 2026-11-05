import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuardarComprobante } from './GuardarComprobante';

const diferencias = [{ renglon: 0, tipo: 'PRECIO', esperado: '1000', facturado: '1030', diferenciaPct: '3.00' }];

describe('GuardarComprobante', () => {
  it('ante 422 muestra las diferencias y reenvía aceptándolas', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 422, message: 'Hay diferencias con la orden de compra', diferencias }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'x', numeroInterno: 7 }), { status: 201 }));
    vi.stubGlobal('fetch', f);
    const onExito = vi.fn();
    render(
      <MantineProvider>
        <GuardarComprobante cuerpo={() => ({ numero: 1 })} onExito={onExito} />
      </MantineProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar comprobante' }));
    expect(await screen.findByText('PRECIO')).toBeInTheDocument();
    expect(screen.getByText('3,00 %')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar diferencias y guardar' }));
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ numero: 1, aceptoDiferencias: true });
    expect(onExito).toHaveBeenCalledWith({ id: 'x', numeroInterno: 7 });
  });

  it('muestra otros errores de la API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Este comprobante ya fue cargado' }), { status: 409 })));
    render(<MantineProvider><GuardarComprobante cuerpo={() => ({})} onExito={() => {}} /></MantineProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar comprobante' }));
    expect(await screen.findByText('Este comprobante ya fue cargado')).toBeInTheDocument();
  });
});
