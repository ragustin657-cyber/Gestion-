import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { BotonGenerar, FacturacionLotesPage, ResultadoLote, TablaVistaPrevia, type GrupoLote } from './FacturacionLotesPage';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);

const grupo = (o: Partial<GrupoLote>): GrupoLote => ({
  terceroId: 't1', razonSocial: 'Constructora Norte', cuit: '30-1', letra: 'A', monedaCodigo: 'ARS', cotizacion: null, remitos: ['R 0001-00000001'], total: '1000.00', problemas: [], avisos: [],
  renglones: [{ remitoRenglonId: 'r1', pedidoRenglonId: null, numero: 'R 0001-00000001', articuloId: 'a', descripcion: 'Producto', cantidad: '1', precioUnitario: '1000', bonificacionPct: '0', alicuota: '21', importe: '1000.00' }], ...o,
});

function Prueba({ grupos }: { grupos: GrupoLote[] }) {
  const [elegidos, setElegidos] = useState<string[]>(grupos.filter((g) => !g.problemas.length).map((g) => `${g.terceroId}|${g.monedaCodigo}`));
  return <><TablaVistaPrevia grupos={grupos} elegidos={elegidos} onChange={setElegidos} /><BotonGenerar cantidad={elegidos.length} onClick={() => {}} /></>;
}

describe('facturación por lotes (web, E55)', () => {
  it('marca los clientes sin problemas y bloquea los que tienen', () => {
    envolver(<Prueba grupos={[grupo({}), grupo({ terceroId: 't2', razonSocial: 'Kiosco Sur', problemas: ['Sin precio: Cable (remito R 0001-00000002)'] }), grupo({ terceroId: 't3', razonSocial: 'Almacén' })]} />);
    expect(screen.getByLabelText('Elegir Constructora Norte')).toBeChecked();
    const kiosco = screen.getByLabelText('Elegir Kiosco Sur');
    expect(kiosco).not.toBeChecked();
    expect(kiosco).toBeDisabled();
    expect(screen.getByText('Sin precio: Cable (remito R 0001-00000002)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar 2 facturas' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Elegir Almacén'));
    expect(screen.getByRole('button', { name: 'Generar 1 factura' })).toBeInTheDocument();
  });

  it('muestra el resultado de cada cliente', () => {
    envolver(<ResultadoLote lote={{ id: 'l', numero: 3, estado: 'TERMINADO', emitidas: 1, sinCae: 1, errores: 0, omitidas: 1, items: [
      { id: 'i1', razonSocial: 'Constructora Norte', monedaCodigo: 'ARS', factura: 'A 0001-00000005', resultado: 'EMITIDA', fce: false, mensaje: null, total: '1210' },
      { id: 'i2', razonSocial: 'Almacén', monedaCodigo: 'ARS', factura: null, resultado: 'SIN_CAE', fce: false, mensaje: 'ARCA rechazó el comprobante', total: '100' },
      { id: 'i3', razonSocial: 'Kiosco Sur', monedaCodigo: 'ARS', factura: null, resultado: 'OMITIDO', fce: false, mensaje: 'Sin precio: Cable', total: '0' },
    ] }} />);
    expect(screen.getByText('Emitida')).toBeInTheDocument();
    expect(screen.getByText('A 0001-00000005')).toBeInTheDocument();
    expect(screen.getByText('Sin CAE')).toBeInTheDocument();
    expect(screen.getByText('ARCA rechazó el comprobante')).toBeInTheDocument();
    expect(screen.getByText('Omitido')).toBeInTheDocument();
  });

  it('el menú tiene la facturación por lotes', () => {
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['venta.emitir']))).toContain('/ventas/facturacion-lotes');
  });

  describe('pantalla', () => {
    afterEach(() => vi.unstubAllGlobals());
    const stub = () => {
      const llamadas: { url: string; body: unknown }[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        if (String(url).includes('vista-previa')) return new Response(JSON.stringify([grupo({}), grupo({ monedaCodigo: 'USD', cotizacion: '1100' })]), { status: 200 });
        if (String(url).includes('/ventas/datos')) return new Response(JSON.stringify({ condicionIva: 'RESPONSABLE_INSCRIPTO', razonSocial: 'E', puntosVenta: [{ id: 'pv', numero: 1, descripcion: null, electronico: true }] }), { status: 200 });
        if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'l', numero: 1, estado: 'TERMINADO', emitidas: 1, sinCae: 0, errores: 0, omitidas: 0, items: [] }), { status: 201 });
        return new Response('[]', { status: 200 });
      }));
      return llamadas;
    };

    it('generar manda solo los grupos elegidos (cliente y moneda)', async () => {
      const llamadas = stub();
      envolver(<FacturacionLotesPage />);
      await waitFor(() => expect(llamadas.some((l) => l.url.includes('/ventas/datos'))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
      const casillas = await screen.findAllByLabelText('Elegir Constructora Norte');
      fireEvent.click(casillas[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Generar 1 factura' }));
      await waitFor(() => expect(llamadas.find((l) => l.body && (l.body as { grupos?: unknown }).grupos)).toBeTruthy());
      expect((llamadas.find((l) => l.body && (l.body as { grupos?: unknown }).grupos)!.body as { grupos: unknown }).grupos).toEqual([{ terceroId: 't1', monedaCodigo: 'ARS' }]);
    });

    it('cambiar un filtro después de Ver obliga a volver a ver', async () => {
      stub();
      envolver(<FacturacionLotesPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
      expect((await screen.findAllByLabelText('Elegir Constructora Norte')).length).toBe(2);
      fireEvent.change(screen.getByLabelText('Remitos hasta'), { target: { value: '2026-12-31' } });
      expect(screen.queryByLabelText('Elegir Constructora Norte')).toBeNull();
    });
  });
});
