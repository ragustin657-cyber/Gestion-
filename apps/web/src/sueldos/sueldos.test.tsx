import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { type LiquidacionDetalle, type Recibo } from './comun';
import { PanelNovedades, TablaLiquidacion, TablaRecibo } from './LiquidacionPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const r = (codigo: string, nombre: string, clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO', importe: string, extra: Partial<Recibo['renglones'][number]> = {}) => ({ codigo, nombre, clase, importe, cantidad: null, base: null, porcentaje: null, orden: Number(codigo), ...extra });
const recibo: Recibo = {
  id: 'r1', empleadoId: 'e1', numero: null, legajo: 1, apellido: 'Pérez', nombre: 'Juan', cuil: '20172543597', categoria: 'Vendedor B', basico: '1000000.00', fechaIngreso: '2021-03-01', antiguedadAnios: 5, diasTrabajados: 30,
  totalRemunerativo: '1168965.00', totalNoRemunerativo: '0.00', totalDescuentos: '227948.18', neto: '941016.82', novedades: [],
  renglones: [
    r('100', 'Sueldo básico', 'REMUNERATIVO', '1000000.00', { cantidad: '30' }), r('110', 'Antigüedad', 'REMUNERATIVO', '50000.00'), r('120', 'Presentismo', 'REMUNERATIVO', '87465.00'),
    r('130', 'Horas extra 50 %', 'REMUNERATIVO', '31500.00', { cantidad: '4' }), r('500', 'Jubilación', 'DESCUENTO', '128586.15', { base: '1168965.00', porcentaje: '11' }),
  ],
};

describe('sueldos (web)', () => {
  it('recibo con columnas por clase y neto', () => {
    envolver(<TablaRecibo recibo={recibo} />);
    for (const c of ['Remunerativo', 'No remunerativo', 'Descuentos']) expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
    expect(screen.getByText('Neto $ 941.016,82')).toBeInTheDocument();
    expect(within(screen.getByText('Jubilación').closest('tr')!).getByText('$ 128.586,15')).toBeInTheDocument();
  });

  it('panel de novedades', () => {
    const cambios: unknown[] = [];
    envolver(<PanelNovedades novedades={[]} onCambiar={(n) => cambios.push(n)} />);
    const campo = screen.getByLabelText('Horas extra 50 %');
    fireEvent.change(campo, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar novedades' }));
    expect(cambios).toEqual([[{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }]]);
  });

  it('liquidación con errores no se puede cerrar', () => {
    const datos: LiquidacionDetalle = {
      id: 'l1', numero: 1, tipo: 'MENSUAL', anio: 2026, mes: 11, fechaPago: '2026-11-30', estado: 'BORRADOR', ultimoDepositoFecha: null, ultimoDepositoBanco: null, ultimoDepositoPeriodo: null,
      errores: [{ empleadoId: 'e2', mensaje: 'Falta la escala de Vendedor A para 11/2026' }], recibos: [recibo],
      totales: { remunerativo: '1168965.00', noRemunerativo: '0.00', descuentos: '227948.18', neto: '941016.82' },
    };
    envolver(<TablaLiquidacion datos={datos} onElegir={() => undefined} />);
    expect(screen.getByText('Falta la escala de Vendedor A para 11/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar liquidación' })).toBeDisabled();
  });

  it('menú de sueldos según permisos', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['sueldos.ver']))).toContain('Liquidaciones');
    expect(titulos(filtrarMenu(MENU, []))).not.toContain('Liquidaciones');
  });
});
