import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { camposCuenta } from '../paginas/PlanCuentasPage';
import { AjusteImpositivo, FormPartida, ResumenAjuste, TablaDinamico } from './AjusteImpositivoPage';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const datos: AjusteImpositivo = {
  ejercicio: { numero: 1, desde: '2026-01-01', hasta: '2026-12-31' },
  estatico: { cuentas: [{ codigo: '1.1.01.001', nombre: 'Caja', tipo: 'ACTIVO', saldo: '1000000.00' }], activo: '1000000.00', pasivo: '400000.00', manualActivo: '0.00', manualPasivo: '0.00', base: '600000.00', coeficiente: '0.500000', ajuste: '-300000.00' },
  dinamico: { movimientos: [
    { fecha: '2026-03-10', asientoNumero: 3, descripcion: 'Compra de rodado', tipo: 'COMPRA_EXCLUIDO', importe: '200000.00', coeficiente: '0.363636', ajuste: '72727.27' },
    { fecha: '2026-05-10', asientoNumero: 4, descripcion: 'Aporte de capital', tipo: 'APORTE', importe: '-100000.00', coeficiente: '0.250000', ajuste: '-25000.00' },
    { fecha: '2026-07-20', asientoNumero: null, descripcion: 'Retiro no identificado', tipo: 'MANUAL', importe: '1000.00', coeficiente: '0.200000', ajuste: '200.00' },
  ], total: '47927.27' },
  partidas: [], variacion36: '87.50', corresponde: false, total: '-252072.73', totalDj: '0.00',
  aviso: 'No corresponde aplicar el ajuste: la variación de los últimos 36 meses es 87,50 %',
};

describe('ajuste por inflación impositivo (web, E45)', () => {
  it('resumen: estático, dinámico, total, total para la DJ y aviso', () => {
    envolver(<ResumenAjuste datos={datos} />);
    expect(screen.getByText('-$ 300.000,00')).toBeInTheDocument();
    expect(screen.getByText('$ 47.927,27')).toBeInTheDocument();
    expect(screen.getByText('-$ 252.072,73')).toBeInTheDocument();
    expect(screen.getByText('No corresponde aplicar el ajuste: la variación de los últimos 36 meses es 87,50 %')).toBeInTheDocument();
  });

  it('dinámico con los tipos en castellano', () => {
    envolver(<TablaDinamico datos={datos} />);
    for (const t of ['Compra de bien excluido', 'Aporte', 'Partida manual']) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('la partida pide fecha solo si es dinámica', () => {
    const { unmount } = envolver(<FormPartida inicial={{ concepto: '', tipo: 'ACTIVO_INICIO', fecha: '', importe: '' }} onGuardar={async () => true} />);
    expect(screen.queryByLabelText('Fecha')).toBeNull();
    unmount();
    envolver(<FormPartida inicial={{ concepto: '', tipo: 'DINAMICO', fecha: '', importe: '' }} onGuardar={async () => true} />);
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument();
  });

  it('plan de cuentas: ajuste impositivo solo para activo y pasivo', () => {
    expect(camposCuenta('ACTIVO', []).map((c) => c.nombre)).toContain('ajusteImpositivo');
    expect(camposCuenta('PATRIMONIO_NETO', []).map((c) => c.nombre)).not.toContain('ajusteImpositivo');
  });

  it('menú: ajuste impositivo con permiso de ver impuestos', () => {
    const rutas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [...(n.ruta ? [n.ruta] : []), ...rutas(n.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['impuestos.ver']))).toContain('/impuestos/ajuste-inflacion');
  });

  it('revisión: aviso de apertura inicial no encontrada', () => {
    envolver(<ResumenAjuste datos={{ ...datos, avisoApertura: 'No se encontró la apertura inicial del primer ejercicio: configúrela en el ajuste por inflación contable o cargue los saldos al inicio como partidas manuales' }} />);
    expect(screen.getByText(/No se encontró la apertura inicial/)).toBeInTheDocument();
  });
});
