import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { type Concepto } from './comun';
import { CampoCodigoArca, TablaConceptos } from './ConceptosPage';
import { AccionesLibro } from './LiquidacionPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const concepto: Concepto = { id: 'c1', convenioId: null, codigo: '100', nombre: 'Sueldo básico', clase: 'REMUNERATIVO', tipo: 'BASICO', parametros: {}, orden: 100, soloAfiliados: false, activo: true, codigoArca: '110000' };

describe('Libro de Sueldos Digital (web)', () => {
  it('campo de código ARCA acepta un valor libre', () => {
    const cambios: string[] = [];
    envolver(<CampoCodigoArca value="160000" onChange={(v) => cambios.push(v)} />);
    const input = screen.getByRole('textbox', { name: 'Código ARCA' }) as HTMLInputElement;
    expect(input.value).toBe('160000');
    fireEvent.change(input, { target: { value: '171000' } });
    expect(cambios).toEqual(['171000']);
  });

  it('campo de código ARCA toma el código de una sugerencia', () => {
    const cambios: string[] = [];
    envolver(<CampoCodigoArca value="" onChange={(v) => cambios.push(v)} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Código ARCA' }), { target: { value: '110000 - Sueldo' } });
    expect(cambios).toEqual(['110000']);
  });

  it('columna de código ARCA', () => {
    envolver(<TablaConceptos conceptos={[concepto]} onEditar={() => undefined} />);
    expect(screen.getByText('Código ARCA')).toBeTruthy();
    expect(screen.getByText('110000')).toBeTruthy();
  });

  it('botón y número del Libro', () => {
    const bajar = vi.fn();
    const { unmount } = envolver(<AccionesLibro estado="CERRADA" numeroLsd={2} onDescargar={bajar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Libro de Sueldos Digital' }));
    expect(bajar).toHaveBeenCalled();
    expect(screen.getByText('Liquidación N° 2 del Libro')).toBeTruthy();
    unmount();
    envolver(<AccionesLibro estado="BORRADOR" numeroLsd={null} onDescargar={bajar} />);
    expect(screen.queryByRole('button', { name: 'Libro de Sueldos Digital' })).toBeNull();
  });
});
