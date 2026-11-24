import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { renglonDeDevolucion } from './ComprobanteVentaPage';
import { TablaDevolvibles } from './RemitoDevolucionPage';
import { RemitosPage } from './PedidosRemitosPages';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);

describe('remitos de devolución (web, E54)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista lo devolvible con el remito de origen', () => {
    const onChange = vi.fn();
    envolver(<TablaDevolvibles filas={[{ remitoRenglonId: 'r1', numero: 'R 0001-00000001', descripcion: 'Producto', entregado: '10', devuelto: '2', quedan: '8' }]} cantidades={{}} onChange={onChange} />);
    expect(screen.getByText('R 0001-00000001')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Devolver Producto'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('nota de crédito: renglón desde devolución con el precio de la factura', () => {
    const r = renglonDeDevolucion({ devolucionRenglonId: 'd1', numero: 'R 0001-00000001', articuloId: 'a', descripcion: 'Producto', pendiente: '3', facturaId: 'f1', factura: 'A 0001-00000002', precioUnitario: '1000', bonificacionPct: '10', alicuota: '21', monedaCodigo: 'ARS' });
    expect(r).toMatchObject({ origen: 'DEVOLUCION', devolucionRenglonId: 'd1', cantidad: '3', precioUnitario: '1000', bonificacionPct: '10', alicuota: '21' });
  });

  it('la consulta de remitos muestra el tipo; el menú tiene la devolución', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x', numeroTexto: 'R 0001-00000001', fecha: '2026-11-04', cliente: 'Cliente', estado: 'CONFIRMADO', tipo: 'DEVOLUCION', pendienteFacturar: '0' }]), { status: 200 })));
    envolver(<RemitosPage />);
    expect(await screen.findByText('Devolución')).toBeInTheDocument();
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['pedido.gestionar']))).toContain('/ventas/remito-devolucion');
  });
});
