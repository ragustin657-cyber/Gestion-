import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { PanelNovedades } from '../sueldos/LiquidacionPage';
import { SelectorVendedor, TablaComisiones } from './ComisionesPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const fila = (o: Record<string, unknown> = {}) => ({ vendedorId: 'v1', nombre: 'Pérez, Juan', tipo: 'EMPLEADO', renglones: 12, neto: '1250000.00', comision: '37500.00', liquidable: true, detalle: [], ...o });

describe('comisiones (web)', () => {
  it('selector de vendedor: solo activos y sin vendedor', () => {
    envolver(<SelectorVendedor vendedores={[{ id: 'v1', nombre: 'Pérez', activo: true }, { id: 'v2', nombre: 'Viejo', activo: false }]} value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('textbox', { name: 'Vendedor' }));
    expect(screen.getByRole('option', { name: 'Pérez' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Sin vendedor' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Viejo' })).toBeNull();
  });

  it('tabla de comisiones con confirmación', () => {
    const confirmados: number[] = [];
    envolver(<TablaComisiones vendedores={[fila(), fila({ vendedorId: 'v2', nombre: 'Ruiz SRL', tipo: 'EXTERNO', comision: '40000.00' })]} puedeLiquidar onConfirmar={() => confirmados.push(1)} />);
    expect(screen.getByText('Pérez, Juan')).toBeTruthy();
    expect(screen.getByText('$ 37.500,00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar liquidación' }));
    expect(confirmados).toEqual([1]);
  });

  it('sin comisiones para liquidar', () => {
    envolver(<TablaComisiones vendedores={[fila({ comision: '-30.00', liquidable: false })]} puedeLiquidar onConfirmar={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Confirmar liquidación' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Sin comisiones para liquidar')).toBeTruthy();
  });

  it('la novedad de comisiones se muestra y no se envía', () => {
    const cambios: unknown[] = [];
    envolver(<PanelNovedades conceptosFijos={[{ id: 'c210', codigo: '210', nombre: 'Comisiones' }]} onCambiar={(n) => cambios.push(n)}
      novedades={[{ tipo: 'IMPORTE', conceptoId: 'c210', importe: 30, detalle: 'Comisiones 11/2026', liquidacionComisionesId: 'l1' }]} />);
    expect(screen.getByText('Comisiones 11/2026: $ 30,00 (de la liquidación de comisiones)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar novedades' }));
    expect(cambios).toEqual([[]]);
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['venta.ver']))).toContain('Comisiones');
    expect(titulos(filtrarMenu(MENU, ['venta.maestros']))).toContain('Vendedores');
  });
});
