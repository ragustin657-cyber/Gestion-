import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { TablaComparacion } from './ComparacionPage';
import { type Grilla } from './comun';
import { GrillaPresupuesto } from './PresupuestosPage';
import { TarjetaPresupuesto } from '../informes/TableroPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const meses = ['2026-10', '2026-11'];
const grilla: Grilla = {
  presupuesto: { id: 'p', nombre: 'Original 2026', vigente: true }, meses,
  lineas: [
    { cuentaContableId: 'v', codigo: '4.1.01', nombre: 'Ventas', tipo: 'INGRESO', centroCostoId: null, centroCosto: null, importes: { '2026-10': '0.00', '2026-11': '1000000.00' }, total: '1000000.00' },
    { cuentaContableId: 'g', codigo: '5.2.01', nombre: 'Gastos generales', tipo: 'EGRESO', centroCostoId: null, centroCosto: null, importes: { '2026-10': '0.00', '2026-11': '300000.00' }, total: '300000.00' },
  ],
  totales: { porMes: { '2026-10': '0.00', '2026-11': '700000.00' }, ingresos: '1000000.00', egresos: '300000.00', resultado: '700000.00' },
};

describe('presupuestos (web)', () => {
  it('grilla con totales y edición', () => {
    const cambios: unknown[] = [];
    envolver(<GrillaPresupuesto grilla={grilla} editable onCambiar={(l, imp) => cambios.push([l.codigo, imp])} />);
    expect(within(screen.getByTestId('fila-resultado')).getAllByText('$ 700.000,00').length).toBeGreaterThan(0);
    const celda = screen.getByLabelText('4.1.01 10/2026');
    fireEvent.change(celda, { target: { value: '5000' } });
    fireEvent.blur(celda);
    expect(cambios).toEqual([['4.1.01', { '2026-10': 5000, '2026-11': 1000000 }]]);
  });

  it('tabla de comparación', () => {
    const t = (presupuesto: string, real: string) => ({ presupuesto, real, desvio: '0.00', desvioPct: null });
    envolver(<TablaComparacion datos={{
      presupuesto: { id: 'p', nombre: 'Original 2026' }, desde: '2026-11', hasta: '2026-11', agrupar: 'cuenta', serie: [],
      filas: [
        { clave: 'v', nombre: '4.1.01 Ventas', tipo: 'INGRESO', presupuesto: '1000000.00', real: '900000.00', desvio: '-100000.00', desvioPct: '-10.00', favorable: false, sinPresupuesto: false },
        { clave: 'c', nombre: '5.2.01 Gastos generales', tipo: 'EGRESO', presupuesto: '0.00', real: '15000.00', desvio: '15000.00', desvioPct: null, favorable: false, sinPresupuesto: true },
      ],
      totales: { ingresos: t('1000000.00', '900000.00'), egresos: t('0.00', '15000.00'), resultado: { presupuesto: '1000000.00', real: '885000.00', desvio: '-115000.00', desvioPct: '-11.50' } },
    }} />);
    expect(screen.getByText('-$ 100.000,00').closest('td')).toHaveAttribute('data-favorable', 'false');
    expect(screen.getByText('Sin presupuestar')).toBeInTheDocument();
    expect(within(screen.getByTestId('total-resultado')).getByText('$ 885.000,00')).toBeInTheDocument();
  });

  it('tarjeta del tablero', () => {
    envolver(<TarjetaPresupuesto datos={{ nombre: 'Original 2026', resultadoPresupuestado: '700000.00', resultadoReal: '545000.00', desvioPct: '-22.14' }} destino="/informes/presupuesto-real" />);
    expect(screen.getByText('$ 545.000,00')).toBeInTheDocument();
    expect(screen.getByText('de $ 700.000,00')).toBeInTheDocument();
    expect(screen.getByText('-22,14 %')).toHaveAttribute('data-variacion', 'baja');
  });

  it('menú', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['presupuesto.ver']))).toEqual(expect.arrayContaining(['Presupuestos', 'Presupuesto contra real']));
    expect(todas(filtrarMenu(MENU, []))).not.toContain('Presupuestos');
  });
});
