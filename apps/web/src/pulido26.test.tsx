import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import { hoy } from './compras/formato';
import { FormLiquidacion } from './tesoreria/TarjetasPages';
import { TablaAgenda } from './ventas/CobranzasPages';
import { TablaComisiones } from './ventas/ComisionesPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const cupon = (id: string, numero: string, importe: string) => ({ id, fecha: '2026-11-05', numero, lote: null, cuotas: 1, importe, cliente: 'Cliente SA' });
const detalle = (porcentaje: string) => ({ tipo: 'COBRO' as const, fecha: '2026-11-05', cliente: 'C', comprobante: 'FC', cobro: 'R', cobrado: '1210.00', neto: '1000.00', porcentaje, comision: '30.00' });
const fila = (o: Record<string, unknown> = {}) => ({ vendedorId: 'v1', nombre: 'Pérez', tipo: 'EMPLEADO', renglones: 1, neto: '1000.00', comision: '30.00', liquidable: true, detalle: [detalle('3.00')], ...o });

describe('pulido 26 (web)', () => {
  afterEach(() => vi.useRealTimers());

  it('hoy() en hora argentina', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T02:30:00Z'));
    expect(hoy()).toBe('2026-11-17');
  });

  it('la liquidación envía solo los cupones que siguen pendientes', () => {
    const enviados: { cuponIds: string[] }[] = [];
    const { rerender } = envolver(<FormLiquidacion cupones={[cupon('c1', '1001', '100.00'), cupon('c2', '1002', '200.00')]} onConfirmar={(d) => enviados.push(d)} />);
    fireEvent.click(screen.getByLabelText('Cupón 1001'));
    fireEvent.click(screen.getByLabelText('Cupón 1002'));
    rerender(<MantineProvider><MemoryRouter><FormLiquidacion cupones={[cupon('c1', '1001', '100.00')]} onConfirmar={(d) => enviados.push(d)} /></MemoryRouter></MantineProvider>);
    expect(screen.getByText('Bruto $ 100,00')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Neto acreditado'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar liquidación' }));
    expect(enviados.map((d) => d.cuponIds)).toEqual([['c1']]);
  });

  it('columna de porcentaje en comisiones', () => {
    envolver(<TablaComisiones vendedores={[fila(), fila({ vendedorId: 'v2', nombre: 'Ruiz', detalle: [detalle('3.00'), detalle('5.00')] })]} puedeLiquidar={false} onConfirmar={() => undefined} />);
    expect(screen.getByText('3,00')).toBeTruthy();
    expect(screen.getByText('varios')).toBeTruthy();
  });

  it('columna por vencer en la agenda', () => {
    envolver(<TablaAgenda onElegir={() => undefined} clientes={[{ terceroId: 't1', cliente: 'Norte', vencido: '500.00', porVencer: '1210.00', aFavor: '0.00', dias: 3, ultimaGestion: null, proximaAccion: null, accionAtrasada: false, promesa: null }]} />);
    expect(screen.getByRole('columnheader', { name: 'Por vencer' })).toBeTruthy();
    expect(screen.getByText('$ 1.210,00')).toBeTruthy();
  });
});
