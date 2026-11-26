import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { cuerpoConfigCot, etiquetaCot, puedePedirCot, SeccionTraslado, type Traslado } from './cot';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);

describe('COT de ARBA (web, E57)', () => {
  it('columna COT: número o estado', () => {
    expect(etiquetaCot({ cot: '1234567890123456', cotEstado: 'OTORGADO' })).toBe('1234567890123456');
    expect(etiquetaCot({ cot: null, cotEstado: 'SIN_PEDIR' })).toBe('Sin pedir');
    expect(etiquetaCot({ cot: null, cotEstado: 'PENDIENTE' })).toBe('Pendiente');
    expect(etiquetaCot({ cot: null, cotEstado: 'RECHAZADO' })).toBe('Rechazado');
    expect(etiquetaCot({ cot: null, cotEstado: 'NO_CORRESPONDE' })).toBe('No corresponde');
    expect(etiquetaCot({ cot: null, cotEstado: null })).toBe('—');
    expect(['SIN_PEDIR', 'PENDIENTE', 'RECHAZADO', 'OTORGADO', 'NO_CORRESPONDE', null].map((e) => puedePedirCot(e as never))).toEqual([true, true, true, false, false, false]);
  });

  it('la configuración no manda la clave si quedó vacía', () => {
    expect(cuerpoConfigCot({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: '', pedirAlConfirmar: false })).toEqual({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', pedirAlConfirmar: false });
    expect(cuerpoConfigCot({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: 'x', pedirAlConfirmar: false }).clave).toBe('x');
  });

  it('la sección de traslado propone la patente del transportista', async () => {
    function Prueba() {
      const [t, setT] = useState<Traslado>({});
      return <SeccionTraslado valor={t} onChange={setT} transportistas={[{ id: 't1', razonSocial: 'Fletes Sur', cuit: '20172543597', patentePorDefecto: 'AB123CD' }]} />;
    }
    envolver(<Prueba />);
    fireEvent.click(screen.getByRole('textbox', { name: 'Transportista' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Fletes Sur' }));
    expect(screen.getByLabelText('Patente')).toHaveValue('AB123CD');
    fireEvent.click(screen.getByRole('textbox', { name: 'Transportista' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Transporte propio' }));
    expect(screen.getByLabelText('Patente')).toHaveValue('');
  });

  it('el menú tiene los transportistas', () => {
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['tercero.ver']))).toContain('/maestros/transportistas');
  });
});
