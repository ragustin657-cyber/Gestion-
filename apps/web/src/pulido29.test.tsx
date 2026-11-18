import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { FormConfigCorreo } from './correo/ConfigCorreoPage';
import { FormLiquidacion } from './tesoreria/TarjetasPages';
import { avisoEnvio, ResultadoEnvio, seleccionTrasFiltro, TablaAgenda } from './ventas/CobranzasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const cupon = (id: string, numero: string) => ({ id, fecha: '2026-11-05', numero, lote: null, cuotas: 1, importe: '100.00', cliente: 'Cliente SA' });
const inicial = { servidor: 'smtp.prueba.local', puerto: 587, seguro: false, usuario: 'u', remitenteNombre: 'Cobranzas', remitenteEmail: 'c@demo.com', asunto: 'A', cuerpo: 'B', claveCargada: true };
const AVISO = 'El mail se envió, pero no se pudo registrar la gestión';

describe('pulido 29 (web)', () => {
  it('un cupón que vuelve no queda tildado', () => {
    const form = (cs: ReturnType<typeof cupon>[]) => <MantineProvider><MemoryRouter><FormLiquidacion cupones={cs} onConfirmar={() => undefined} /></MemoryRouter></MantineProvider>;
    const { rerender } = render(form([cupon('c1', '1001'), cupon('c2', '1002')]));
    fireEvent.click(screen.getByLabelText('Cupón 1001'));
    fireEvent.click(screen.getByLabelText('Cupón 1002'));
    rerender(form([cupon('c1', '1001')]));
    rerender(form([cupon('c1', '1001'), cupon('c2', '1002')]));
    expect((screen.getByLabelText('Cupón 1001') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Cupón 1002') as HTMLInputElement).checked).toBe(false);
  });

  it('guardar exige remitente, asunto y cuerpo', () => {
    envolver(<FormConfigCorreo inicial={{ ...inicial, asunto: '' }} onGuardar={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('guardar sin nombre del remitente o sin cuerpo', () => {
    const { unmount } = envolver(<FormConfigCorreo inicial={{ ...inicial, remitenteNombre: '' }} onGuardar={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    envolver(<FormConfigCorreo inicial={{ ...inicial, cuerpo: '  ' }} onGuardar={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('aviso del envío', () => {
    expect(avisoEnvio({ aviso: AVISO })).toBe(AVISO);
    expect(avisoEnvio({})).toBeNull();
    envolver(<ResultadoEnvio enviados={[{ terceroId: 't1', cliente: 'Norte', destinatario: 'a@b.com', aviso: AVISO }]} omitidos={[]} />);
    expect(screen.getByText(`Norte: ${AVISO}`)).toBeTruthy();
  });

  it('la selección se limpia al filtrar', () => {
    expect(seleccionTrasFiltro()).toEqual([]);
    const fila = { terceroId: 't1', cliente: 'Norte', vencido: '100.00', porVencer: '0.00', aFavor: '0.00', dias: 5, ultimaGestion: null, proximaAccion: null, accionAtrasada: false, promesa: null };
    envolver(<TablaAgenda clientes={[fila]} onElegir={() => undefined} seleccion={seleccionTrasFiltro()} onSeleccion={() => undefined} />);
    expect((screen.getByLabelText('Seleccionar Norte') as HTMLInputElement).checked).toBe(false);
  });
});
