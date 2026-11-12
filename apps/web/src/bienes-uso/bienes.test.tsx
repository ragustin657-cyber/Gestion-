import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { VistaPreviaAmortizacion } from './AmortizacionPage';
import { CamposBien } from './comun';
import { TablaPlanilla } from './PlanillaBienesPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const fila = (rubro: string, neto: string) => ({ rubroId: rubro, rubro, origenInicio: '0.00', altas: neto, bajas: '0.00', origenCierre: neto, amortInicio: '0.00', amortBajas: '0.00', amortEjercicio: '0.00', amortCierre: '0.00', neto });

describe('bienes de uso (web)', () => {
  it('planilla con totales y control con el Mayor', () => {
    const datos = { fecha: '2026-10-31', filas: [fila('Muebles y útiles', '117000.00'), fila('Rodados', '0.00')], totales: fila('Total', '117000.00'), control: { origen: '0.00', amortizacion: '0.00' } };
    const { unmount } = envolver(<TablaPlanilla datos={datos} />);
    expect(within(screen.getByTestId('fila-total')).getAllByText('$ 117.000,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Coincide con el Mayor')).toBeInTheDocument();
    unmount();
    envolver(<TablaPlanilla datos={{ ...datos, control: { origen: '500.00', amortizacion: '0.00' } }} />);
    expect(screen.getByText('Diferencia con el Mayor: valor de origen $ 500,00 · amortizaciones $ 0,00')).toBeInTheDocument();
  });

  it('campos del bien con la vida útil del rubro', () => {
    const cambios: unknown[] = [];
    envolver(<CamposBien rubro={{ id: 'r', nombre: 'Rodados', vidaUtilMeses: 60 }} valor={{ descripcion: 'Camioneta', vidaUtilMeses: '', valorResidual: '' }} onChange={(v) => cambios.push(v)} />);
    expect(screen.getByLabelText('Vida útil (meses)')).toHaveAttribute('placeholder', '60');
    fireEvent.change(screen.getByLabelText('Descripción del bien'), { target: { value: 'Camioneta 4x4' } });
    expect(cambios.at(-1)).toMatchObject({ descripcion: 'Camioneta 4x4' });
  });

  it('vista previa de la amortización', () => {
    const { unmount } = envolver(<VistaPreviaAmortizacion datos={{ mes: '2026-09', filas: [], porRubro: [{ rubroId: 'r', nombre: 'Rodados', importe: '140000.00' }], total: '140000.00' }} onGenerar={() => {}} />);
    expect(screen.getAllByText('$ 140.000,00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled();
    unmount();
    envolver(<VistaPreviaAmortizacion datos={{ mes: '2026-09', filas: [], porRubro: [], total: '0.00' }} onGenerar={() => {}} />);
    expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();
  });

  it('menú de bienes de uso', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['bienes.ver']))).toEqual(expect.arrayContaining(['Bienes de uso', 'Planilla de bienes de uso']));
    expect(todas(filtrarMenu(MENU, ['bienes.gestionar']))).toContain('Rubros de bienes de uso');
    expect(todas(filtrarMenu(MENU, ['contabilidad.cerrar']))).toContain('Amortización del mes');
    expect(todas(filtrarMenu(MENU, []))).not.toContain('Planilla de bienes de uso');
  });
});
