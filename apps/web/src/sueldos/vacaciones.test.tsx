import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { DialogoPeriodo, TablaSaldosVacaciones } from './VacacionesPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const fila = (empleadoId: string, nombre: string, pendientes: number) => ({ empleadoId, legajo: 1, nombre, corresponden: 21, saldoInicial: null, tomados: 21 - pendientes, pendientes, periodos: [] });

describe('vacaciones (web)', () => {
  it('tabla de saldos', () => {
    envolver(<TablaSaldosVacaciones filas={[fila('a', 'Pérez, Juan', -3), fila('b', 'Gómez, Ana', 7)]} onElegir={() => undefined} />);
    expect(screen.getByText('-3').closest('td')).toHaveAttribute('data-negativo', 'true');
    expect(screen.getByText('7').closest('td')).toHaveAttribute('data-negativo', 'false');
  });

  it('diálogo de período', () => {
    const guardados: unknown[] = [];
    envolver(<DialogoPeriodo empleado={{ id: 'e1', nombre: 'Pérez, Juan' }} anio={2026} onGuardar={(d) => guardados.push(d)} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-09' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-22' } });
    expect(screen.getByText('14 días')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(guardados).toEqual([{ empleadoId: 'e1', anio: 2026, desde: '2026-11-09', hasta: '2026-11-22', liquidadoAfuera: false }]);
  });

  it('avisos', () => {
    envolver(<DialogoPeriodo empleado={{ id: 'e1', nombre: 'Pérez, Juan' }} anio={2026} avisos={['Supera el saldo de 2026 (quedan 7 días)']} onGuardar={() => undefined} />);
    expect(screen.getByText('Supera el saldo de 2026 (quedan 7 días)')).toBeInTheDocument();
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['sueldos.ver']))).toContain('Vacaciones');
  });
});
