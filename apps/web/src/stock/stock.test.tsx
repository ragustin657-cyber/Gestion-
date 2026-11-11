import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { GrillaInventario } from './DocumentoStockPage';
import { TablaKardex } from './KardexPage';
import { ControlValuacion } from './ValuacionPage';

const conMantine = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);

describe('stock (web)', () => {
  it('el inventario físico muestra la diferencia contra el sistema', () => {
    conMantine(<GrillaInventario
      articulos={[{ id: 'a', codigo: 'A-1', descripcion: 'Lámpara' }, { id: 'b', codigo: 'B-1', descripcion: 'Cable' }]}
      saldos={{ a: '10', b: '10' }}
      renglones={[{ articuloId: 'a', cantidad: '12' }, { articuloId: 'b', cantidad: '9' }]}
      onChange={() => {}} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('el kardex muestra entradas, salidas y saldo de valor', () => {
    conMantine(<TablaKardex kardex={{
      articulo: { id: 'a', codigo: 'A-1', descripcion: 'Lámpara', unidad: 'UN' }, saldoInicial: { cantidad: '0', valor: '0.00' },
      movimientos: [
        { id: '1', fecha: '2026-11-05', tipo: 'RECEPCION', documento: 'Recepción N° 1', anulacion: false, entrada: '150', salida: null, saldoCantidad: '150', costoUnitario: '11.666667', importe: '1750.00', saldoValor: '1750.00' },
        { id: '2', fecha: '2026-11-06', tipo: 'VENTA', documento: 'Factura A 00001-00000001', anulacion: false, entrada: null, salida: '120', saldoCantidad: '30', costoUnitario: '11.666667', importe: '-1400.00', saldoValor: '350.00' },
      ],
    }} />);
    expect(screen.getByText('Recepción N° 1')).toBeInTheDocument();
    expect(screen.getByText('-$ 1.400,00')).toBeInTheDocument();
    expect(screen.getByText('$ 350,00')).toBeInTheDocument();
  });

  it('el control de valuación compara con el Mayor', () => {
    const { rerender } = conMantine(<ControlValuacion valuacion={{ fecha: '2026-11-30', filas: [], total: '466.67', mayor: '466.67', control: '0.00' }} />);
    expect(screen.getByText('Coincide con el Mayor')).toBeInTheDocument();
    rerender(<MantineProvider><ControlValuacion valuacion={{ fecha: '2026-11-30', filas: [], total: '476.67', mayor: '466.67', control: '10.00' }} /></MantineProvider>);
    expect(screen.getByText('Diferencia con el Mayor: $ 10,00')).toBeInTheDocument();
  });
});
