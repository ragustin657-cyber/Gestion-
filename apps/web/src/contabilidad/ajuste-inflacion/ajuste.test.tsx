import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TablaAjustes, TablaPreviaAjuste } from './AjusteInflacionPage';
import { GrillaAnticuacion } from './ConfigAjustePage';

const conMantine = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);

const PREVIA = {
  ejercicio: { id: 'e1', numero: 1 }, fecha: '2026-03-31', recpam: '-220.00', avisos: [] as string[], renglones: [],
  cuentas: [
    { cuentaContableId: 'a', codigo: '1.2.01.002', nombre: 'Rodados', saldoContable: '600.00', reexpresado: '1440.00', ajuste: '840.00', cuentaAjuste: null },
    { cuentaContableId: 'b', codigo: '3.1.01', nombre: 'Capital social', saldoContable: '-1000.00', reexpresado: '-2400.00', ajuste: '-1400.00', cuentaAjuste: '3.1.02' },
  ],
};

describe('ajuste por inflación (web)', () => {
  it('la vista previa muestra los ajustes, el RECPAM y los avisos', () => {
    conMantine(<TablaPreviaAjuste previa={{ ...PREVIA, avisos: ['1.2.01.002: 200.00 sin anticuar, se toma al inicio del ejercicio'] }} />);
    expect(screen.getByText('$ 840,00')).toBeInTheDocument();
    expect(screen.getByText('-$ 1.400,00')).toBeInTheDocument();
    expect(screen.getByText('en 3.1.02')).toBeInTheDocument();
    expect(screen.getByText('RECPAM (pérdida)')).toBeInTheDocument();
    expect(screen.getByText('-$ 220,00')).toBeInTheDocument();
    expect(screen.getByText('1.2.01.002: 200.00 sin anticuar, se toma al inicio del ejercicio')).toBeInTheDocument();
  });

  it('solo el último ajuste vigente se puede anular', () => {
    const onAnular = vi.fn();
    conMantine(<TablaAjustes onAnular={onAnular} filas={[
      { asientoId: 'x2', numero: 12, fecha: '2026-03-31', ejercicio: 1, recpam: '-220.00', anulado: false },
      { asientoId: 'x1', numero: 8, fecha: '2026-02-28', ejercicio: 1, recpam: '-10.00', anulado: false },
      { asientoId: 'x0', numero: 5, fecha: '2026-01-31', ejercicio: 1, recpam: '-5.00', anulado: true },
    ]} />);
    const botones = screen.getAllByRole('button', { name: 'Anular' });
    expect(botones).toHaveLength(1);
    fireEvent.click(botones[0]);
    expect(onAnular).toHaveBeenCalledWith('x2');
    expect(screen.getByText('Anulado')).toBeInTheDocument();
  });

  it('la grilla de anticuación muestra lo que falta anticuar', () => {
    conMantine(<GrillaAnticuacion onChange={() => {}} cuentas={[
      { cuentaContableId: 'a', codigo: '1.2.01.002', nombre: 'Rodados', saldoApertura: '600.00', tramos: [{ anio: 2025, mes: 6, importe: '400.00' }] },
    ]} />);
    expect(screen.getByText('Sin anticuar: $ 200,00')).toBeInTheDocument();
  });
});
