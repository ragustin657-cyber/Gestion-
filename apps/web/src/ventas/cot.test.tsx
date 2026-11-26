import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { cuerpoConfigCot, cuerpoTraslado, etiquetaCot, puedePedirCot, SeccionTraslado, type Traslado } from './cot';
import { descargar } from '../api/cliente';

const envolver = (n: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><AuthProvider>{n}</AuthProvider></MemoryRouter></QueryClientProvider></MantineProvider>);

describe('COT de ARBA (web, E57)', () => {
  it('columna COT: número o estado', () => {
    expect(etiquetaCot({ cot: '1234567890123456', cotEstado: 'OTORGADO' })).toBe('1234567890123456');
    expect(etiquetaCot({ cot: null, cotEstado: 'SIN_PEDIR' })).toBe('Sin pedir');
    expect(etiquetaCot({ cot: null, cotEstado: 'PENDIENTE' })).toBe('Pendiente');
    expect(etiquetaCot({ cot: null, cotEstado: 'RECHAZADO' })).toBe('Rechazado');
    expect(etiquetaCot({ cot: null, cotEstado: 'NO_CORRESPONDE' })).toBe('No corresponde');
    expect(etiquetaCot({ cot: null, cotEstado: null })).toBe('—');
    expect(['SIN_PEDIR', 'PENDIENTE', 'RECHAZADO', 'OTORGADO', 'NO_CORRESPONDE', null].map((e) => puedePedirCot(e as never))).toEqual([true, true, true, false, false, false]);
  });

  it('la configuración no manda la clave si quedó vacía', () => {
    expect(cuerpoConfigCot({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: '', pedirAlConfirmar: false })).toEqual({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', pedirAlConfirmar: false });
    expect(cuerpoConfigCot({ activo: true, ambiente: 'SIMULADO', usuario: '30712345671', clave: 'x', pedirAlConfirmar: false }).clave).toBe('x');
  });

  it('la sección de traslado propone la patente del transportista', async () => {
    function Prueba() {
      const [t, setT] = useState<Traslado>({});
      return <SeccionTraslado valor={t} onChange={setT} transportistas={[{ id: 't1', razonSocial: 'Fletes Sur', cuit: '20172543597', patentePorDefecto: 'AB123CD' }]} />;
    }
    envolver(<Prueba />);
    fireEvent.click(screen.getByRole('textbox', { name: 'Transportista' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Fletes Sur' }));
    expect(screen.getByLabelText('Patente')).toHaveValue('AB123CD');
    fireEvent.click(screen.getByRole('textbox', { name: 'Transportista' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Transporte propio' }));
    expect(screen.getByLabelText('Patente')).toHaveValue('');
  });

  it('el menú tiene los transportistas', () => {
    const rutas = (n: NodoMenu[]): string[] => n.flatMap((x) => [...(x.ruta ? [x.ruta] : []), ...rutas(x.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['tercero.ver']))).toContain('/maestros/transportistas');
  });

  describe('revisión final', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('en la edición los campos vaciados van como null; en el alta se omiten', () => {
      const t: Traslado = { patente: '', patenteAcoplado: '', calle: 'San Martín', transportistaId: null, fechaSalida: '2026-11-07', horaSalida: '1430' };
      expect(cuerpoTraslado(t, true)).toEqual({ patente: null, patenteAcoplado: null, calle: 'San Martín', transportistaId: null, fechaSalida: '2026-11-07', horaSalida: '1430' });
      expect(cuerpoTraslado(t)).toEqual({ calle: 'San Martín', transportistaId: null, fechaSalida: '2026-11-07', horaSalida: '1430' });
    });

    it('la sección tiene fecha y hora de salida', () => {
      envolver(<SeccionTraslado valor={{}} onChange={() => {}} transportistas={[]} />);
      expect(screen.getByLabelText('Fecha de salida')).toBeInTheDocument();
      expect(screen.getByLabelText('Hora de salida (HHMM)')).toBeInTheDocument();
    });

    it('descargar sin nombre usa el que manda el servidor', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('01|x', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="TB_30712345671_000001002_20261106_000003.txt"' } })));
      const urlOrig = URL.createObjectURL;
      URL.createObjectURL = () => 'blob:x';
      let nombre = '';
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombre = this.download; });
      await descargar('/ventas/remitos/r1/cot/archivo', {});
      expect(nombre).toBe('TB_30712345671_000001002_20261106_000003.txt');
      click.mockRestore();
      URL.createObjectURL = urlOrig;
    });
  });
});
