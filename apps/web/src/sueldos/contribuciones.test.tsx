import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { TablaCargasSociales } from './CargasSocialesPage';
import { TablaContribuciones } from './ContribucionesPage';
import { PanelPagos } from './PanelPagos';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);

describe('sueldos parte 2 (web)', () => {
  it('tabla de contribuciones con vigencias', () => {
    const f = (id: string, alicuota: string, desdeMes: number) => ({ id, codigo: 'SIPA', nombre: 'Jubilación (SIPA)', destino: 'SEGURIDAD_SOCIAL' as const, alicuota, importeFijo: '0.00', aplicaDetraccion: true, cuentaContableId: 'c', desdeAnio: 2026, desdeMes, activa: true });
    envolver(<TablaContribuciones filas={[f('a', '10.77', 1), f('b', '12.35', 12)]} />);
    expect(screen.getByText('01/2026')).toBeInTheDocument();
    expect(screen.getByText('12/2026')).toBeInTheDocument();
    expect(screen.getByText('10,77 %')).toBeInTheDocument();
  });

  it('panel de pagos', () => {
    const pagados: string[][] = [];
    const r = (id: string, legajo: number, pagado: boolean) => ({ id, legajo, apellido: 'Pérez', nombre: `Juan ${legajo}`, neto: '941016.82', pagado });
    envolver(<PanelPagos recibos={[r('r1', 1, true), r('r2', 2, false)]} onPagar={(ids) => pagados.push(ids)} />);
    const fila1 = screen.getByText('Pérez, Juan 1').closest('tr')!;
    expect(within(fila1).getByText('Pagado')).toBeInTheDocument();
    expect(within(fila1).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(screen.getByText('Pérez, Juan 2').closest('tr')!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Pagar seleccionados' }));
    expect(pagados).toEqual([['r2']]);
  });

  it('tabla de cargas sociales', () => {
    const pagar: string[] = [];
    envolver(<TablaCargasSociales onPagar={(f) => pagar.push(f.codigo)} filas={[
      { cuentaContableId: 'a', codigo: '2.1.03.002', nombre: 'Cargas sociales a pagar', devengado: '509739.11', pagado: '0.00', pendiente: '509739.11', detalle: { aportesSS: '163655.10', aportesOS: '35068.95', contribucionesSS: '209153.03', contribucionesOS: '70137.90', art: '30724.13', scvo: '1000.00' } },
      { cuentaContableId: 'b', codigo: '2.1.03.003', nombre: 'Retenciones sindicales a pagar', devengado: '29224.13', pagado: '29224.13', pendiente: '0.00' },
    ]} />);
    const f1 = screen.getByText('2.1.03.002 Cargas sociales a pagar').closest('tr')!;
    expect(within(f1).getAllByText('$ 509.739,11').length).toBeGreaterThan(0);
    fireEvent.click(within(f1).getByRole('button', { name: 'Pagar' }));
    expect(pagar).toEqual(['2.1.03.002']);
    expect(within(screen.getByText('2.1.03.003 Retenciones sindicales a pagar').closest('tr')!).queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(screen.getByText('$ 209.153,03')).toBeInTheDocument();
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['sueldos.ver']))).toEqual(expect.arrayContaining(['Cargas sociales', 'Contribuciones']));
  });
});
