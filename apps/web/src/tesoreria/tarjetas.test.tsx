import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { diferenciaLiquidacion, FormLiquidacion, RenglonesCupones } from './TarjetasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const ejemplo = { bruto: 150000, arancel: 2700, ivaArancel: 567, costoFinanciero: 0, ivaCostoFinanciero: 0, impuestos: [1500, 1000, 2250], neto: 141983 };

describe('tarjetas (web)', () => {
  it('diferencia de la liquidación', () => {
    expect(diferenciaLiquidacion(ejemplo)).toBe(0);
    expect(diferenciaLiquidacion({ ...ejemplo, neto: 141982.99 })).toBe(0.01);
  });

  it('formulario de liquidación', () => {
    const cupones = [{ id: 'c1', fecha: '2026-11-05', numero: '1001', lote: null, cuotas: 1, importe: '100000.00', cliente: 'Cliente SA' }, { id: 'c2', fecha: '2026-11-05', numero: '1002', lote: null, cuotas: 1, importe: '50000.00', cliente: 'Cliente SA' }];
    envolver(<FormLiquidacion cupones={cupones} onConfirmar={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Cupón 1001'));
    fireEvent.click(screen.getByLabelText('Cupón 1002'));
    expect(screen.getByText('Bruto $ 150.000,00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Arancel'), { target: { value: '2700' } });
    fireEvent.change(screen.getByLabelText('IVA del arancel'), { target: { value: '567' } });
    fireEvent.change(screen.getByLabelText('Neto acreditado'), { target: { value: '146733' } });
    expect(screen.getByText('Diferencia $ 0,00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar liquidación' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Neto acreditado'), { target: { value: '146732,99' } });
    expect(screen.getByText('Diferencia $ 0,01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar liquidación' })).toBeDisabled();
  });

  it('renglones de cupones', () => {
    const cambios: unknown[] = [];
    envolver(<RenglonesCupones tarjetas={[{ id: 't1', nombre: 'Visa crédito', activa: true }]} cupones={[]} onCambiar={(c) => cambios.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar cupón' }));
    expect(cambios.at(-1)).toEqual([{ tarjetaId: 't1', lote: '', numero: '', cuotas: 1, importe: '' }]);
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['tesoreria.ver']))).toContain('Cupones de tarjetas');
  });
});
