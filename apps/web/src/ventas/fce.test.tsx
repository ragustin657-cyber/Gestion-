import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { CamposFce, ConfigFce, ModalRechazo, TablaFce } from './fce';

const envolver = (n: ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider></MantineProvider>);
const responder = (rutas: Record<string, unknown>) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const k = Object.keys(rutas).find((r) => String(url).includes(r));
  return new Response(JSON.stringify(k ? rutas[k] : []), { status: 200 });
}));
const fila = (o: Record<string, unknown>) => ({
  id: 'f', cuitContraparte: '30700123452', cbteTipo: 201, puntoVenta: 1, numero: 123, fecha: '2026-11-02', importe: '1210.00', moneda: 'PES', fechaVencimientoPago: '2026-12-02',
  estado: 'PENDIENTE', fechaRecepcion: '2026-11-02', fechaLimite: '2026-12-02', diasRestantes: 10, motivosRechazo: [], textoRechazo: null, comprobanteVentaId: null, comprobanteCompraId: null,
  compraCargada: false, cliente: 'Proveedor SA', notas: [], ...o,
});

describe('factura de crédito MiPyME (web, E50)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('configuración: MiPyME, cuenta con CBU y transferencia', async () => {
    responder({ '/tesoreria/cuentas-bancarias': [{ id: 'c1', numero: '1', cbu: '2850590940090418135201', activa: true, banco: { nombre: 'Nación' } }, { id: 'c2', numero: '2', cbu: null, activa: true, banco: { nombre: 'Galicia' } }] });
    envolver(<ConfigFce config={{ mipyme: true, cuentaBancariaFceId: 'c1', transferenciaFce: 'SCA' }} onGuardar={async () => {}} />);
    expect(screen.getByLabelText('La empresa es MiPyME')).toBeChecked();
    expect((await screen.findAllByLabelText('Cuenta bancaria para la factura de crédito'))[0]).toBeInTheDocument();
    expect(screen.getAllByLabelText('Transferencia por defecto')[0]).toBeInTheDocument();
  });

  it('comprobante: propone FCE cuando corresponde y avisa el mínimo', async () => {
    responder({ '/ventas/fce/obligacion': { obligado: true, montoMinimo: '1000000.00', corresponde: true, aviso: null, consultadoEn: null } });
    const onFce = vi.fn();
    envolver(<CamposFce tipo="FACTURA" terceroId="t" fecha="2026-11-02" totalPesos={2000000} fce={false} onFce={onFce} transferencia={null} onTransferencia={() => {}} anulacion={false} onAnulacion={() => {}} />);
    expect(await screen.findByText('Corresponde factura de crédito: el cliente está obligado desde $ 1.000.000,00')).toBeInTheDocument();
    await waitFor(() => expect(onFce).toHaveBeenCalledWith(true));
  });

  it('comprobante: sin mínimo conocido (marca manual) el aviso no muestra importe', async () => {
    responder({ '/ventas/fce/obligacion': { obligado: true, montoMinimo: null, corresponde: true, aviso: null, consultadoEn: null } });
    envolver(<CamposFce tipo="FACTURA" terceroId="t" fecha="2026-11-02" totalPesos={100} fce onFce={() => {}} transferencia={null} onTransferencia={() => {}} anulacion={false} onAnulacion={() => {}} />);
    expect(await screen.findByText('Corresponde factura de crédito: el cliente está obligado')).toBeInTheDocument();
  });

  it('comprobante: no la propone si no corresponde; la nota FCE muestra la anulación', async () => {
    responder({ '/ventas/fce/obligacion': { obligado: true, montoMinimo: '1000000.00', corresponde: false, aviso: null, consultadoEn: null } });
    const onFce = vi.fn();
    const { unmount } = envolver(<CamposFce tipo="FACTURA" terceroId="t" fecha="2026-11-02" totalPesos={100} fce={false} onFce={onFce} transferencia={null} onTransferencia={() => {}} anulacion={false} onAnulacion={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(onFce).not.toHaveBeenCalled();
    unmount();
    envolver(<CamposFce tipo="NOTA_CREDITO" terceroId="t" fecha="2026-11-02" totalPesos={100} fce onFce={() => {}} transferencia={null} onTransferencia={() => {}} anulacion={false} onAnulacion={() => {}} />);
    expect(screen.getByLabelText('Anulación (rechazo de la factura)')).toBeInTheDocument();
  });

  it('recibidas: resalta el plazo de 5 días o menos', () => {
    envolver(<TablaFce rol="RECEPTOR" filas={[fila({ id: 'a', numero: 1, diasRestantes: 3 }), fila({ id: 'b', numero: 2, diasRestantes: 10 })]} puedeResponder onAceptar={() => {}} onRechazar={() => {}} />);
    expect(screen.getByText('3 días')).toHaveAttribute('data-urgente', 'true');
    expect(screen.getByText('10 días')).toHaveAttribute('data-urgente', 'false');
    expect(screen.getAllByRole('button', { name: 'Aceptar' })).toHaveLength(2);
  });

  it('rechazar exige un motivo', async () => {
    const onConfirmar = vi.fn();
    envolver(<ModalRechazo abierto motivos={[{ codigo: '1', descripcion: 'Mercadería no entregada' }]} onCerrar={() => {}} onConfirmar={onConfirmar} />);
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeDisabled();
  });

  it('menú: emitidas con venta.ver y recibidas con fc.ver', () => {
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['venta.ver']))).toContain('/ventas/fce');
    expect(rutas(filtrarMenu(MENU, ['fc.ver']))).toContain('/compras/fce');
    expect(rutas(filtrarMenu(MENU, ['venta.ver']))).not.toContain('/compras/fce');
  });
});

describe('ficha del cliente (web, E50)', () => {
  it('marca manual y texto de la última consulta', async () => {
    const { camposImpuestos, textoConsultaFce } = await import('../paginas/TercerosPage');
    expect(camposImpuestos([]).map((c) => c.nombre)).toContain('fceObligadoManual');
    expect(textoConsultaFce({ fceConsultadoEn: '2026-11-05T15:00:00Z', fceObligado: true, fceMontoMinimo: '3958316.00' })).toBe('Según ARCA al 05/11/2026: obligado a recibir factura de crédito MiPyME desde $ 3.958.316,00');
    expect(textoConsultaFce({ fceConsultadoEn: null })).toBeNull();
  });
});
