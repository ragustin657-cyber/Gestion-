import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { TablaIngresosProvincia } from './IngresosProvinciaPage';
import { TablaJurisdiccionesCm } from './JurisdiccionesCm';
import { DetallePosicionIibb, TablaMesesIibb, type PosicionIibbWeb } from './PosicionIibbPage';

const envolver = (n: ReactNode) => render(<MantineProvider>{n}</MantineProvider>);
const d = (jurisdiccion: string, o: Record<string, string> = {}) => ({
  jurisdiccion, coeficiente: '0.500000', alicuota: '3.0000', base: '50000.00', impuesto: '1500.00', retenciones: '0.00', percepciones: '0.00', saldoAnterior: '0.00', aPagar: '1500.00', saldoAFavor: '0.00', ...o,
});
const base: PosicionIibbWeb = {
  anio: 2026, mes: 10, estado: 'BORRADOR', ingresos: '100000.00', avisos: [], asientoId: null,
  detalle: [d('901'), d('904', { retenciones: '2000.00', aPagar: '0.00', saldoAFavor: '500.00' })],
  totales: { base: '100000.00', impuesto: '3000.00', retenciones: '2000.00', percepciones: '0.00', saldoAnterior: '0.00', aPagar: '1500.00', saldoAFavor: '500.00' },
};

describe('liquidación de IIBB (web)', () => {
  it('detalle por jurisdicción con a pagar, saldo a favor y totales', () => {
    envolver(<DetallePosicionIibb p={{ ...base, avisos: ['Hay retenciones o percepciones de la jurisdicción 913 Mendoza, que no está en el Convenio de 2026'] }} />);
    expect(screen.getByText('901 CABA')).toBeTruthy();
    expect(screen.getByText('904 Córdoba')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getAllByText('$ 500,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Hay retenciones o percepciones de la jurisdicción 913 Mendoza, que no está en el Convenio de 2026')).toBeTruthy();
  });

  it('tabla de meses', () => {
    envolver(<TablaMesesIibb meses={[{ mes: 9, estado: 'CERRADA', aPagar: '100.00', saldoAFavor: '0.00' }, { mes: 10, estado: null, aPagar: null, saldoAFavor: null }]} elegido={10} onElegir={() => undefined} />);
    expect(screen.getByText('Cerrada')).toBeTruthy();
    expect(screen.getByText('A pagar $ 100,00')).toBeTruthy();
  });

  it('jurisdicciones: suma de coeficientes; saldo inicial solo en el año de inicio', () => {
    const filas = [{ jurisdiccion: '901', coeficiente: 0.6, alicuota: 3, actividad: '620100', saldoInicial: 0 }, { jurisdiccion: '902', coeficiente: 0.3, alicuota: 4, actividad: '620100', saldoInicial: 0 }];
    const { unmount } = envolver(<TablaJurisdiccionesCm filas={filas} conSaldoInicial onChange={() => undefined} />);
    expect(screen.getByText('Suma de coeficientes: 0,9000')).toBeTruthy();
    expect(screen.getByText('Saldo inicial')).toBeTruthy();
    unmount();
    envolver(<TablaJurisdiccionesCm filas={filas} conSaldoInicial={false} onChange={() => undefined} />);
    expect(screen.queryByText('Saldo inicial')).toBeNull();
  });

  it('ingresos por provincia con «Sin provincia»', () => {
    envolver(<TablaIngresosProvincia r={{ anio: 2026, total: '1000.00', avisos: [], filas: [{ jurisdiccion: '904', nombre: '904 Córdoba', ingresos: '800.00', porcentaje: '80.00' }, { jurisdiccion: null, nombre: 'Sin provincia', ingresos: '200.00', porcentaje: '20.00' }] }} />);
    expect(screen.getByText('Sin provincia')).toBeTruthy();
    expect(screen.getByText('80,00 %')).toBeTruthy();
  });
});
