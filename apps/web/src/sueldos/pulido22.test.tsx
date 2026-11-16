import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { PanelNovedades } from './LiquidacionPage';
import { PanelPagos } from './PanelPagos';
import { DialogoPeriodo } from './VacacionesPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);

describe('pulido 22 (web)', () => {
  it('novedades de importe para conceptos fijos', () => {
    const cambios: unknown[] = [];
    envolver(<PanelNovedades novedades={[]} conceptosFijos={[{ id: 'c200', codigo: '200', nombre: 'Premio' }]} onCambiar={(n) => cambios.push(n)} />);
    fireEvent.change(screen.getByLabelText('200 Premio'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar novedades' }));
    expect(cambios).toEqual([[{ tipo: 'IMPORTE', conceptoId: 'c200', importe: 50000 }]]);
  });

  it('pagar seleccionados mantiene la selección hasta confirmar', () => {
    const pagos: string[][] = [];
    const r = (id: string, legajo: number) => ({ id, legajo, apellido: 'Pérez', nombre: `Juan ${legajo}`, neto: '1000.00', pagado: false });
    const { rerender } = envolver(<PanelPagos recibos={[r('r1', 1), r('r2', 2)]} onPagar={(ids) => pagos.push(ids)} />);
    const casilla = within(screen.getByText('Pérez, Juan 2').closest('tr')!).getByRole('checkbox');
    fireEvent.click(casilla);
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seleccionados' }));
    expect(pagos).toEqual([['r2']]);
    expect(casilla).toBeChecked();
    rerender(<MantineProvider><MemoryRouter><PanelPagos recibos={[r('r1', 1), r('r2', 2)]} onPagar={(ids) => pagos.push(ids)} pagados={1} /></MemoryRouter></MantineProvider>);
    expect(within(screen.getByText('Pérez, Juan 2').closest('tr')!).getByRole('checkbox')).not.toBeChecked();
  });

  it('observaciones del período', () => {
    const guardados: unknown[] = [];
    envolver(<DialogoPeriodo empleado={{ id: 'e1', nombre: 'Pérez, Juan' }} anio={2026} onGuardar={(d) => guardados.push(d)} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-09' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Acordado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(guardados).toEqual([{ empleadoId: 'e1', anio: 2026, desde: '2026-11-09', hasta: '2026-11-10', liquidadoAfuera: false, observaciones: 'Acordado' }]);
  });
});
