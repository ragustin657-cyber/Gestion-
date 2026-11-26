import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EditorEscalas } from '../articulos/EditorEscalas';
import { AuthProvider } from '../auth/AuthContext';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { aplicarBonificacionSugerida, GrillaVenta, type RenglonVentaEditable } from './GrillaVenta';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);
const renglon = (o: Partial<RenglonVentaEditable> = {}): RenglonVentaEditable => ({ articuloId: 'a', descripcion: 'Agua', cantidad: '12', precioUnitario: '100', alicuota: '21', ...o });

describe('descuentos por cantidad (web, E56)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aplicarBonificacionSugerida: aplica, respeta lo manual, descarta respuestas viejas y vacía', () => {
    expect(aplicarBonificacionSugerida([renglon()], 0, 'a', '12', '5')[0].bonificacionPct).toBe('5');
    expect(aplicarBonificacionSugerida([renglon({ bonificacionPct: '7', bonificacionManual: true })], 0, 'a', '12', '5')[0].bonificacionPct).toBe('7');
    const viejo = [renglon({ cantidad: '13' })];
    expect(aplicarBonificacionSugerida(viejo, 0, 'a', '12', '5')).toBe(viejo);
    expect(aplicarBonificacionSugerida([renglon({ bonificacionPct: '5' })], 0, 'a', '12', null)[0].bonificacionPct).toBe('');
    const deRemito = [renglon({ origen: 'REMITO' })];
    expect(aplicarBonificacionSugerida(deRemito, 0, 'a', '12', '5')).toBe(deRemito);
  });

  it('la grilla sugiere la bonificación al elegir artículo y al cambiar la cantidad; lo escrito a mano queda', async () => {
    const sugerir = vi.fn(async (_a: string, c: string) => (Number(c) >= 12 ? '5' : null));
    function Prueba() {
      const [r, setR] = useState<RenglonVentaEditable[]>([{ articuloId: null, descripcion: '', cantidad: '12', precioUnitario: '', alicuota: '21' }]);
      return <GrillaVenta renglones={r} onChange={setR} letra="A" moneda="ARS" articulos={[{ value: 'a', label: 'AGUA - Agua', descripcion: 'Agua', alicuotaIva: '21' }]} sugerirBonificacion={sugerir} />;
    }
    envolver(<Prueba />);
    fireEvent.click(screen.getByRole('textbox', { name: 'Artículo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'AGUA - Agua' }));
    await waitFor(() => expect(screen.getByLabelText('Bonificación %')).toHaveValue('5'));
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '3' } });
    await waitFor(() => expect(screen.getByLabelText('Bonificación %')).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('Bonificación %'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '20' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText('Bonificación %')).toHaveValue('7');
  });

  it('el editor de escalas guarda las filas; el menú tiene los rubros', async () => {
    const llamadas: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url: String(url), init });
      return new Response(JSON.stringify([]), { status: 200 });
    }));
    envolver(<EditorEscalas url="/rubros-articulos/r1/escalas" />);
    const agregar = await screen.findByRole('button', { name: 'Agregar escala' });
    await waitFor(() => expect(agregar).toBeEnabled());
    fireEvent.click(agregar);
    fireEvent.change(screen.getByLabelText('Desde cantidad 1'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('% de descuento 1'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar escalas' }));
    await waitFor(() => expect(llamadas.some((l) => l.init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(llamadas.find((l) => l.init?.method === 'PUT')!.init!.body))).toEqual({ escalas: [{ desde: 12, porcentaje: 5 }] });
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['articulo.ver']))).toContain('/maestros/rubros-articulos');
  });
});
