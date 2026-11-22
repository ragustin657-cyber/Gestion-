import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { EscalaSociedades } from './ConfigImpuestosPage';
import { Dj, PanelDj } from './DjGananciasPage';

const envolver = (n: ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider></MantineProvider>);
const anticipos = Array.from({ length: 10 }, (_, i) => ({ numero: i + 1, mes: i < 7 ? `2027-${String(i + 6).padStart(2, '0')}` : `2028-0${i - 6}`, porcentaje: i ? '8.33' : '25', importe: i ? '233240.00' : '700000.00' }));
const dj = (estado: 'BORRADOR' | 'PRESENTADA'): Dj => ({
  ejercicio: { numero: 1, desde: '2026-01-01', hasta: '2026-12-31', estado: 'CERRADO' }, estado,
  datos: { quebrantosAnteriores: '0.00', anticiposIngresados: '0.00', saldoAFavorAnterior: '0.00', impuestoCheque: '0.00', otrosPagos: '0.00' },
  ajustes: [{ id: 'a', concepto: 'Gastos no deducibles', importe: '500000.00' }],
  determinacion: {
    resultadoContable: '10000000.00', ajusteAmortizaciones: '0.00', ajusteInflacion: '0.00', totalAjustesManuales: '500000.00', resultadoImpositivo: '10500000.00',
    quebrantosComputados: '0.00', quebrantoEjercicio: '0.00', gananciaNetaImponible: '10500000.00', impuestoDeterminado: '2900000.00', retenciones: '100000.00', percepciones: '0.00',
    pagosACuenta: '100000.00', saldo: '2800000.00', baseAnticipos: '2800000.00', vencimientoDj: '2027-05', anticipos, avisos: [],
  },
  presentaciones: estado === 'PRESENTADA' ? [{ numero: 0, presentadaEn: '2027-04-10T12:00:00Z', presentadaPor: 'u', anuladaEn: null, motivoAnulacion: null }] : [],
});

describe('DJ de Ganancias de sociedades (web, E46)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('determinación con impuesto, saldo a pagar y anticipos con su mes', () => {
    envolver(<PanelDj ejercicioId="e" datos={dj('BORRADOR')} puedeEditar alCambiar={() => {}} />);
    expect(screen.getAllByText('$ 10.500.000,00')).toHaveLength(2);
    expect(screen.getByText('$ 2.900.000,00')).toBeInTheDocument();
    expect(screen.getByText(/A pagar/)).toBeInTheDocument();
    expect(screen.getByText('06/2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como presentada' })).toBeInTheDocument();
  });

  it('presentada: sin edición y con anulación', () => {
    envolver(<PanelDj ejercicioId="e" datos={dj('PRESENTADA')} puedeEditar alCambiar={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Guardar datos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nuevo ajuste' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anular presentación' })).toBeInTheDocument();
  });

  it('escala: copiar la de la ley 27.630 llena los tres tramos', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', f);
    envolver(<EscalaSociedades />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 50));
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar escala de la ley 27.630' }));
    expect(screen.getAllByLabelText(/^Desde/)).toHaveLength(3);
    expect((screen.getAllByLabelText(/^Monto fijo/)[2] as HTMLInputElement).value).toBe('14.750.000');
  });

  it('menú: DJ de Ganancias con permiso de ver impuestos', () => {
    const rutas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [...(n.ruta ? [n.ruta] : []), ...rutas(n.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['impuestos.ver']))).toContain('/impuestos/dj-ganancias');
  });
});
