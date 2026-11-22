import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigImpuestosPage } from '../impuestos/ConfigImpuestosPage';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { DatosImpositivosBien } from './BienesPage';
import { PlanillaImpositiva, TablaImpositiva } from './PlanillaImpositivaPage';
import { CamposImpositivosRubro } from './RubrosPage';

const envolver = (n: ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider></MantineProvider>);
const tot = { cuota: '264000.00', noDeducible: '0.00', deducible: '264000.00', contable: '160000.00', diferencia: '104000.00', valorResidual: '1056000.00' };
const datos: PlanillaImpositiva = {
  ejercicio: { numero: 1, desde: '2026-01-01', hasta: '2026-12-31' }, avisos: ['Se usa la vida útil contable de: Rodados'], totales: tot,
  filas: [{ rubroId: 'r', rubro: 'Rodados', subtotal: tot, bienes: [{
    numero: 1, descripcion: 'Camioneta', fechaAlta: '2026-03-15', fechaBaja: null, tipo: 'MUEBLE', vidaUtilAnios: 5, valorOrigen: '1200000.00', actualiza: true, coeficiente: '1.1000',
    valorActualizado: '1320000.00', aniosAnteriores: 0, acumuladaAnterior: '0.00', cuota: '264000.00', noDeducible: '0.00', acumuladaCierre: '264000.00', valorResidual: '1056000.00',
    costoComputableBaja: null, contable: '160000.00', diferencia: '104000.00',
  }] }],
};

describe('amortización impositiva (web, E44)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('planilla: rubro, bien, cuota, diferencia, totales y avisos', () => {
    envolver(<TablaImpositiva datos={datos} />);
    expect(screen.getByText('Se usa la vida útil contable de: Rodados')).toBeInTheDocument();
    expect(screen.getByText('1 Camioneta')).toBeInTheDocument();
    const total = within(screen.getByTestId('total-impositiva'));
    expect(total.getAllByText('$ 264.000,00').length).toBeGreaterThan(0);
    expect(total.getByText('$ 104.000,00')).toBeInTheDocument();
  });

  it('rubro: vida útil impositiva y tipo impositivo', () => {
    envolver(<CamposImpositivosRubro valor={{ vidaUtilImpositivaAnios: '', tipoImpositivo: 'MUEBLE' }} onChange={() => {}} />);
    expect(screen.getByLabelText('Vida útil impositiva (años)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tipo impositivo' })).toHaveValue('Mueble');
  });

  it('ficha del bien: vida impositiva y terreno solo para inmuebles', () => {
    const { unmount } = envolver(<DatosImpositivosBien bien={{ id: 'b', valorOrigen: '1000', vidaUtilImpositivaAnios: null, valorTerreno: '0', rubro: { id: 'r', nombre: 'Edificios', tipoImpositivo: 'INMUEBLE', vidaUtilImpositivaAnios: null } }} puedeEditar alGuardar={() => {}} />);
    expect(screen.getByLabelText('Vida útil impositiva (años)')).toBeInTheDocument();
    expect(screen.getByLabelText('Valor del terreno')).toBeInTheDocument();
    unmount();
    envolver(<DatosImpositivosBien bien={{ id: 'b', valorOrigen: '1000', vidaUtilImpositivaAnios: null, valorTerreno: '0', rubro: { id: 'r', nombre: 'Rodados', tipoImpositivo: 'MUEBLE', vidaUtilImpositivaAnios: 5 } }} puedeEditar alGuardar={() => {}} />);
    expect(screen.queryByLabelText('Valor del terreno')).toBeNull();
  });

  it('configuración de impuestos: tope de automóviles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029', ivaSaldoTecnicoInicial: '0', ivaSaldoLibreInicial: '0', prorrateoIva: false, prorrateoInicioMes: 1, prorrateoGravadasIniciales: '0', prorrateoExentasIniciales: '0', sireMotivoAnulacion: 1, topeAutomovilesCosto: '20000' }), { status: 200 })));
    envolver(<ConfigImpuestosPage />);
    expect(await screen.findByLabelText('Tope de costo de automóviles')).toBeInTheDocument();
  });

  it('menú: planilla impositiva con permiso de bienes', () => {
    const rutas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [...(n.ruta ? [n.ruta] : []), ...rutas(n.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['bienes.ver']))).toContain('/contabilidad/planilla-impositiva');
  });

  it('revisión: el terreno con separador de miles se guarda bien', async () => {
    const llamadas: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { llamadas.push({ url, body: String(init?.body ?? '') }); return new Response('{}', { status: 200 }); }));
    envolver(<DatosImpositivosBien bien={{ id: 'b', valorOrigen: '5000000', vidaUtilImpositivaAnios: null, valorTerreno: '0', rubro: { id: 'r', nombre: 'Edificios', tipoImpositivo: 'INMUEBLE', vidaUtilImpositivaAnios: null } }} puedeEditar alGuardar={() => {}} />);
    fireEvent.change(screen.getByLabelText('Valor del terreno'), { target: { value: '1.500.000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar datos impositivos' }));
    await waitFor(() => expect(llamadas.some((l) => l.url.includes('/impositivo'))).toBe(true));
    expect(JSON.parse(llamadas.find((l) => l.url.includes('/impositivo'))!.body).valorTerreno).toBe(1500000);
  });
});
