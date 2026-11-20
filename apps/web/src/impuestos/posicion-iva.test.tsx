import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { DetallePosicionIva, mesAnterior, TablaMesesIva, type PosicionIvaWeb } from './PosicionIvaPage';

const envolver = (n: ReactNode) => render(<MantineProvider>{n}</MantineProvider>);
const base: PosicionIvaWeb = {
  anio: 2026, mes: 10, estado: 'BORRADOR', debito: { '21': '210.00' }, credito: { '21': '105.00' }, totalDebito: '210.00', totalCredito: '105.00',
  saldoTecnicoAnterior: '0.00', libreAnterior: '0.00', retenciones: '30.00', percepciones: '20.00', saldoTecnicoAFavor: '0.00', impuestoDeterminado: '105.00',
  impuestoAPagar: '55.00', libreDisponibilidad: '0.00', avisos: [], asientoId: null,
};

describe('posición de IVA (web)', () => {
  it('detalle con débito por alícuota e impuesto a pagar', () => {
    envolver(<DetallePosicionIva p={base} />);
    expect(screen.getByText('Débito fiscal 21 %')).toBeTruthy();
    expect(screen.getByText('Impuesto a pagar')).toBeTruthy();
    expect(screen.getByText('$ 55,00')).toBeTruthy();
  });

  it('saldo de libre disponibilidad y avisos', () => {
    envolver(<DetallePosicionIva p={{ ...base, impuestoAPagar: '0.00', libreDisponibilidad: '50.00', avisos: ['El mes anterior no está cerrado: los saldos anteriores pueden cambiar'] }} />);
    expect(screen.getByText('Saldo de libre disponibilidad')).toBeTruthy();
    expect(screen.getByText('El mes anterior no está cerrado: los saldos anteriores pueden cambiar')).toBeTruthy();
  });

  it('tabla de meses con los cerrados', () => {
    envolver(<TablaMesesIva meses={[{ mes: 9, estado: 'CERRADA', impuestoAPagar: '100.00', saldoTecnicoAFavor: '0.00', libreDisponibilidad: '0.00' }, { mes: 10, estado: null, impuestoAPagar: null, saldoTecnicoAFavor: null, libreDisponibilidad: null }]} elegido={10} onElegir={() => undefined} />);
    expect(screen.getByText('Cerrada')).toBeTruthy();
    expect(screen.getByText('Septiembre')).toBeTruthy();
  });

  it('en enero arranca en diciembre del año anterior (revisión E37)', () => {
    expect(mesAnterior(new Date(2027, 0, 15))).toEqual({ anio: 2026, mes: 12 });
    expect(mesAnterior(new Date(2026, 10, 20))).toEqual({ anio: 2026, mes: 10 });
  });
});
