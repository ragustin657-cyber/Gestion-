import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { FormConfigCorreo } from '../correo/ConfigCorreoPage';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { ResultadoEnvio, TablaAgenda } from './CobranzasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const inicial = { servidor: 'smtp.prueba.local', puerto: 587, seguro: false, usuario: 'u', remitenteNombre: 'Cobranzas', remitenteEmail: 'c@demo.com', asunto: 'A', cuerpo: 'B', claveCargada: true };

describe('recordatorios por mail (web)', () => {
  it('la configuración no muestra la clave y no la envía si no se toca', () => {
    const guardados: Record<string, unknown>[] = [];
    envolver(<FormConfigCorreo inicial={inicial} onGuardar={(d) => guardados.push(d)} />);
    expect((screen.getByLabelText('Clave') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Dejar vacío para conservar la actual')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(guardados).toHaveLength(1);
    expect('clave' in guardados[0]).toBe(false);
  });

  it('resultado del envío masivo', () => {
    envolver(<ResultadoEnvio enviados={[{ terceroId: 't1', cliente: 'Norte', destinatario: 'a@b.com' }]} omitidos={[{ terceroId: 't2', cliente: 'Sur', motivo: 'Sin email' }]} />);
    expect(screen.getByText('1 enviado')).toBeTruthy();
    expect(screen.getByText(/Sin email/)).toBeTruthy();
  });

  it('selección en la agenda', () => {
    const sel: string[][] = [];
    envolver(<TablaAgenda clientes={[{ terceroId: 't1', cliente: 'Norte', vencido: '500.00', porVencer: '0.00', aFavor: '0.00', dias: 3, ultimaGestion: null, proximaAccion: null, accionAtrasada: false, promesa: null }]} onElegir={() => undefined} seleccion={[]} onSeleccion={(x) => sel.push(x)} />);
    fireEvent.click(screen.getByLabelText('Seleccionar Norte'));
    expect(sel).toEqual([['t1']]);
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['correo.configurar']))).toContain('Configuración de correo');
  });
});
