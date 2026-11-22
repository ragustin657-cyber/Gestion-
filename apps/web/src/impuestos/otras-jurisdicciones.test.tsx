import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { cuerpoJurisdicciones, TablaJurisdiccionesIibb } from '../pagos/ConfigRetencionesPage';
import { descripcionRetencion } from '../pagos/tipos';
import { NOMBRE_PRESENTACION } from './comun';
import { DetallePosicionIibb, PosicionIibbWeb } from './PosicionIibbPage';
import { TablaRecaudaciones } from './RecaudacionesBancariasPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);

describe('otras jurisdicciones de IIBB (web, E48)', () => {
  it('presentaciones SIRCAR', () => {
    expect([NOMBRE_PRESENTACION.SIRCAR_RETENCIONES, NOMBRE_PRESENTACION.SIRCAR_PERCEPCIONES]).toEqual(['SIRCAR retenciones (IIBB Convenio)', 'SIRCAR percepciones (IIBB Convenio)']);
  });

  it('recaudaciones por jurisdicción con su nombre', () => {
    envolver(<TablaRecaudaciones filas={[{ id: 'r', periodo: '202611', jurisdiccion: '904', nombre: 'Córdoba', importe: '2000.00', cbu: null, referencia: null }]} onEditar={() => {}} onEliminar={() => {}} editable />);
    expect(screen.getByText('904 Córdoba')).toBeInTheDocument();
    expect(screen.getAllByText('$ 2.000,00')).toHaveLength(2);
  });

  it('la liquidación de IIBB muestra las recaudaciones bancarias', () => {
    const d = { jurisdiccion: '902', coeficiente: '1', alicuota: '4', base: '0', impuesto: '0', retenciones: '0', percepciones: '0', recaudaciones: '2000.00', saldoAnterior: '0', aPagar: '0', saldoAFavor: '2000.00' };
    const p: PosicionIibbWeb = { anio: 2026, mes: 10, estado: 'BORRADOR', ingresos: '0', detalle: [d], totales: d, avisos: [], asientoId: null };
    envolver(<DetallePosicionIibb p={p} />);
    expect(screen.getByText('Recaudaciones bancarias')).toBeInTheDocument();
  });

  it('jurisdicciones: régimen SIRCAR de retención y percepción', () => {
    envolver(<TablaJurisdiccionesIibb filas={[{ jurisdiccion: '904', alicuotaDefecto: '0', minimoRetencion: '0', usaPadron: false, sinPadron: 'NO_RETENER', percibe: false, alicuotaPercepcionDefecto: '0', minimoPercepcion: '0', sinPadronPercepcion: 'NO_RETENER', regimenSircarRetencion: '011', regimenSircarPercepcion: null }]} onCambiar={() => {}} />);
    expect(screen.getByLabelText('Régimen SIRCAR de retención')).toHaveValue('011');
    expect(screen.getByLabelText('Régimen SIRCAR de percepción')).toBeInTheDocument();
    expect(screen.getByText(/Córdoba/)).toBeInTheDocument();
  });

  it('constancias con el nombre de cualquier jurisdicción', () => {
    expect(descripcionRetencion({ impuesto: 'IIBB', jurisdiccion: '904', regimen: null })).toBe('IIBB Córdoba');
  });

  it('menú: recaudaciones bancarias con permiso de ver impuestos', () => {
    const rutas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [...(n.ruta ? [n.ruta] : []), ...rutas(n.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['impuestos.ver']))).toContain('/impuestos/recaudaciones-bancarias');
  });

  it('revisión: guardar las jurisdicciones envía los regímenes SIRCAR', () => {
    const [f] = cuerpoJurisdicciones([{ jurisdiccion: '904', alicuotaDefecto: '0', minimoRetencion: '0', usaPadron: false, sinPadron: 'NO_RETENER', percibe: false, alicuotaPercepcionDefecto: '0', minimoPercepcion: '0', sinPadronPercepcion: 'NO_RETENER', regimenSircarRetencion: '011', regimenSircarPercepcion: '' }]);
    expect([f.regimenSircarRetencion, f.regimenSircarPercepcion]).toEqual(['011', null]);
  });
});
