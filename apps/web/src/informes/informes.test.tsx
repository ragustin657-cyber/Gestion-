import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { seriesVentas } from './comun';
import { TablaAntiguedad } from './InformesPages';
import { TarjetaIndicador } from './TableroPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);

describe('informes de gestión', () => {
  it('tarjeta con variación positiva, negativa y sin anterior', () => {
    const { unmount } = envolver(<TarjetaIndicador titulo="Ventas" valor="1100.00" anterior="1000.00" formato="moneda" destino="/informes/ventas" />);
    expect(screen.getByText('$ 1.100,00')).toBeInTheDocument();
    expect(screen.getByText('+10,00 %')).toHaveAttribute('data-variacion', 'sube');
    unmount();
    const r = envolver(<TarjetaIndicador titulo="Ventas" valor="1100.00" anterior="1200.00" formato="moneda" destino="/informes/ventas" />);
    expect(screen.getByText('-8,33 %')).toHaveAttribute('data-variacion', 'baja');
    r.unmount();
    envolver(<TarjetaIndicador titulo="Stock" valor="670.00" formato="moneda" destino="/informes/rotacion" />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('tabla de antigüedad con totales', () => {
    const fila = (id: string, n: string) => ({ terceroId: id, nombre: n, aVencer: '100.00', d1_30: '10.00', d31_60: '0.00', d61_90: '0.00', mas90: '5.00', aFavor: '-20.00', total: '95.00' });
    envolver(<TablaAntiguedad datos={{ filas: [fila('a', 'Uno'), fila('b', 'Dos')], totales: { aVencer: '200.00', d1_30: '20.00', d31_60: '0.00', d61_90: '0.00', mas90: '10.00', aFavor: '-40.00', total: '190.00' } }} />);
    const total = within(screen.getByTestId('fila-total'));
    expect(total.getByText('$ 200,00')).toBeInTheDocument();
    expect(total.getByText('-$ 40,00')).toBeInTheDocument();
    expect(total.getByText('$ 190,00')).toBeInTheDocument();
  });

  it('serie de ventas para el gráfico', () => {
    expect(seriesVentas([{ mes: '2026-11', ventas: '1060.00', costo: '330.00', margen: '430.00' }])).toEqual([{ mes: 'nov 26', ventas: 1060, margen: 430 }]);
  });

  it('menú de informes', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['informes.ver']))).toEqual(expect.arrayContaining(['Informes de gestión', 'Tablero de dirección', 'Antigüedad de saldos']));
    expect(todas(filtrarMenu(MENU, []))).not.toContain('Tablero de dirección');
  });
});
