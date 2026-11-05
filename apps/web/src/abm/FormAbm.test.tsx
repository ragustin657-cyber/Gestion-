import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorApi } from '../api/cliente';
import { FormAbm } from './FormAbm';

const campos = [
  { nombre: 'razonSocial', etiqueta: 'Razón social', tipo: 'texto' as const, requerido: true },
  { nombre: 'cuit', etiqueta: 'CUIT', tipo: 'texto' as const },
];

describe('FormAbm', () => {
  it('muestra el error de campo devuelto por la API junto al campo', async () => {
    const onEnviar = vi.fn().mockRejectedValue(new ErrorApi(400, 'CUIT inválido', { cuit: 'CUIT inválido' }));
    render(
      <MantineProvider>
        <FormAbm campos={campos} valoresIniciales={{ razonSocial: 'X', cuit: '1' }} onEnviar={onEnviar} />
      </MantineProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('CUIT inválido')).toBeInTheDocument();
    expect(screen.getByLabelText('CUIT')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Razón social/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('envía los valores con los vacíos opcionales como null', async () => {
    const onEnviar = vi.fn().mockResolvedValue({});
    render(
      <MantineProvider>
        <FormAbm campos={campos} valoresIniciales={{ razonSocial: 'Y', cuit: '' }} onEnviar={onEnviar} />
      </MantineProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onEnviar).toHaveBeenCalledWith({ razonSocial: 'Y', cuit: null });
  });
});
