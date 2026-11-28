import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { avisoTrasAccionCot, cuerpoConfigCot, etiquetaResultadoCot } from './cot';
import { claveDevolucion, elegirDevoluciones } from './ComprobanteVentaPage';
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

  describe('revisión final', () => {
    const fila = (facturaId: string, pendiente: string) => ({ devolucionRenglonId: 'd1', numero: 'R 0001-00000002', articuloId: 'a', descripcion: 'Producto', pendiente, facturaId, factura: facturaId, precioUnitario: '1000', bonificacionPct: '0', alicuota: '21', monedaCodigo: 'ARS' });
    it('las devoluciones se eligen por factura y solo de una factura a la vez', () => {
      const p = [fila('F1', '6'), fila('F2', '4')];
      expect(claveDevolucion(p[0])).not.toBe(claveDevolucion(p[1]));
      const r = elegirDevoluciones(p, [claveDevolucion(p[1]), claveDevolucion(p[0])]);
      expect([r.facturaId, r.renglones.map((x) => x.cantidad)]).toEqual(['F2', ['4']]);
    });

    it('destildar exportación con un artículo que no está en la lista deja el renglón exento', () => {
      expect(restaurarAlicuotas([{ articuloId: 'zz', descripcion: 'x', cantidad: '1', precioUnitario: '1', alicuota: 'EXENTO' }], []).map((x) => x.alicuota)).toEqual(['EXENTO']);
    });

    it('guardar el traslado muestra su aviso, no el estado del COT', () => {
      expect(avisoTrasAccionCot({ cotEstado: 'SIN_PEDIR', cotMensaje: null }, false, 'Traslado guardado')).toEqual({ color: 'green', texto: 'Traslado guardado' });
      expect(avisoTrasAccionCot({ cotEstado: 'RECHAZADO', cotMensaje: 'x' }, true, 'Pedido del COT enviado').color).toBe('red');
    });
  });
});
