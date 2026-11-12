import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { TablaPendientes } from './PedidosRemitosPages';
import { vistaPreviaAumento } from './precios';

describe('ventas completas (web)', () => {
  it('vista previa del aumento con la misma regla que el servidor', () => {
    expect(vistaPreviaAumento([{ codigo: 'A', precio: '2500' }], 7.3, '10')).toEqual([{ codigo: 'A', antes: '2500', despues: '2680' }]);
    expect(vistaPreviaAumento([{ codigo: 'B', precio: '0.5' }], -90, '1')[0].despues).toBe('1');
    const siete = Array.from({ length: 7 }, (_, i) => ({ codigo: `X${i}`, precio: '100' }));
    expect(vistaPreviaAumento(siete, 10, '1')).toHaveLength(5);
  });

  it('tabla de pendientes para facturar', () => {
    const onChange = vi.fn();
    render(<MantineProvider><TablaPendientes seleccion={{}} onChange={onChange} pendientes={[
      { id: 'r1', origen: 'REMITO', numero: 'R 0001-00000001', descripcion: 'Lámpara', pendiente: '20' },
    ]} /></MantineProvider>);
    expect(screen.getByText('R 0001-00000001')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Elegir R 0001-00000001' }));
    expect(onChange).toHaveBeenCalledWith({ r1: '20' });
  });
});
