import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { serieFlujo, TablaFlujo, type Flujo } from './FlujoFondosPage';

const fila = (etiqueta: string, desde: string, saldo: string) => ({
  desde, hasta: desde, etiqueta, ingresos: { cheques: '0.00', transferencias: '0.00', cobranzas: '0.00', vencidoACobrar: '0.00' },
  egresos: { chequesPropios: '0.00', ordenesPago: '48400.00', proveedores: '0.00', vencidoAPagar: '0.00' }, totalIngresos: '42100.00', totalEgresos: '48400.00', saldo,
});
const datos = (saldo: string): Flujo => ({ desde: '2026-11-06', hasta: '2026-11-08', agrupar: 'semana', incluirVencidos: true, saldoInicial: '105000.00', filas: [fila('06/11–08/11', '2026-11-06', saldo)], primerNegativo: Number(saldo) < 0 ? '06/11–08/11' : null });

describe('flujo de fondos (web)', () => {
  it('saldo negativo en rojo y alerta', () => {
    render(<MantineProvider><TablaFlujo datos={datos('-500.00')} onPeriodo={() => {}} /></MantineProvider>);
    expect(screen.getByText('-$ 500,00')).toHaveAttribute('data-negativo', 'true');
    expect(screen.getByText('El saldo queda negativo en 06/11–08/11')).toBeInTheDocument();
  });

  it('saldo inicial y clic en un período', () => {
    const elegidos: unknown[] = [];
    render(<MantineProvider><TablaFlujo datos={datos('98700.00')} onPeriodo={(p) => elegidos.push(p)} /></MantineProvider>);
    expect(screen.getByText('$ 105.000,00')).toBeInTheDocument();
    fireEvent.click(screen.getByText('06/11–08/11'));
    expect(elegidos).toEqual([{ desde: '2026-11-06', hasta: '2026-11-06', etiqueta: '06/11–08/11' }]);
  });

  it('serie del gráfico', () => {
    expect(serieFlujo(datos('98700.00').filas)).toEqual([{ periodo: '06/11–08/11', ingresos: 42100, egresos: 48400, saldo: 98700 }]);
  });
});
