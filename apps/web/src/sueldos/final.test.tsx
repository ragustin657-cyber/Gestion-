import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { periodoLiquidacion } from './comun';
import { DialogoBaja, TarjetaEgreso } from './DialogoBaja';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);

describe('liquidación final (web)', () => {
  it('diálogo de baja', () => {
    const enviados: unknown[] = [];
    envolver(<DialogoBaja empleado={{ id: 'e1', legajo: 1, apellido: 'Pérez', nombre: 'Juan' }} onConfirmar={(d) => enviados.push(d)} />);
    fireEvent.change(screen.getByLabelText('Fecha de egreso'), { target: { value: '2026-11-15' } });
    expect((screen.getByLabelText('Fecha de pago') as HTMLInputElement).value).toBe('2026-11-19');
    expect(screen.getByLabelText('Preaviso otorgado')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gratificación')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    expect(enviados).toEqual([{ empleadoId: 'e1', causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' }]);
  });

  it('mutuo acuerdo muestra gratificación', () => {
    envolver(<DialogoBaja empleado={{ id: 'e1', legajo: 1, apellido: 'Pérez', nombre: 'Juan' }} causaInicial="MUTUO_ACUERDO" onConfirmar={() => undefined} />);
    expect(screen.getByLabelText('Gratificación')).toBeInTheDocument();
    expect(screen.queryByLabelText('Preaviso otorgado')).toBeNull();
  });

  it('tarjeta del egreso y período', () => {
    envolver(<TarjetaEgreso egreso={{ causa: 'DESPIDO_SIN_CAUSA', fechaEgreso: '2026-11-15', preavisoOtorgado: false, mejorRemuneracion: null, gratificacion: '0.00', empleado: { id: 'e1', legajo: 1, apellido: 'Pérez', nombre: 'Juan' } }} />);
    expect(screen.getByText('Despido sin causa')).toBeInTheDocument();
    expect(screen.getByText('15/11/2026')).toBeInTheDocument();
    expect(screen.getByText('Sin preaviso')).toBeInTheDocument();
    expect(periodoLiquidacion({ tipo: 'FINAL', anio: 2026, mes: 11, empleado: { apellido: 'Pérez', nombre: 'Juan' } })).toBe('Final 11/2026 - Pérez, Juan');
  });
});
