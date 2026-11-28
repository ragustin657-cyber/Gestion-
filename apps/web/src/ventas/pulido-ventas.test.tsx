import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { cuerpoConfigCot, etiquetaResultadoCot } from './cot';
import { restaurarAlicuotas } from './exportacion';
import { quitarArticulo } from './GrillaVenta';
import { RemitosPage } from './PedidosRemitosPages';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);

describe('pulido de ventas (web, E59)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('6. quitar el artículo borra la bonificación sugerida, no la manual', () => {
    expect(quitarArticulo({ articuloId: 'a', descripcion: 'x', cantidad: '12', precioUnitario: '1', alicuota: '21', bonificacionPct: '5' })).toMatchObject({ articuloId: null, bonificacionPct: '' });
    expect(quitarArticulo({ articuloId: 'a', descripcion: 'x', cantidad: '12', precioUnitario: '1', alicuota: '21', bonificacionPct: '7', bonificacionManual: true }).bonificacionPct).toBe('7');
  });

  it('17. sin exportación los renglones vuelven a la alícuota del artículo', () => {
    const r = restaurarAlicuotas([
      { articuloId: 'a', descripcion: 'x', cantidad: '1', precioUnitario: '1', alicuota: 'EXENTO' },
      { articuloId: null, descripcion: 'y', cantidad: '1', precioUnitario: '1', alicuota: 'EXENTO' },
    ], [{ value: 'a', label: 'A', descripcion: 'A', alicuotaIva: '10.5' }]);
    expect(r.map((x) => x.alicuota)).toEqual(['10.5', '21']);
  });

  it('14-15. COT rechazado en rojo; borrar la clave', () => {
    expect(etiquetaResultadoCot({ cotEstado: 'RECHAZADO', cotMensaje: 'Patente inválida' })).toEqual({ color: 'red', texto: 'ARBA rechazó el COT: Patente inválida' });
    expect(etiquetaResultadoCot({ cotEstado: 'OTORGADO', cotMensaje: null })).toEqual({ color: 'green', texto: 'COT otorgado' });
    expect(cuerpoConfigCot({ activo: true, ambiente: 'SIMULADO', usuario: '1', clave: '', pedirAlConfirmar: false, borrarClave: true }).clave).toBeNull();
  });

  it('1. la consulta de remitos muestra las devoluciones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x', numeroTexto: 'R 0001-00000001', fecha: '2026-11-04', cliente: 'Cliente', estado: 'CONFIRMADO', tipo: 'ENTREGA', pendienteFacturar: '0', cot: null, cotEstado: null, devoluciones: ['R 0001-00000002'] }]), { status: 200 })));
    envolver(<RemitosPage />);
    expect(await screen.findByText('R 0001-00000002')).toBeInTheDocument();
  });
});
