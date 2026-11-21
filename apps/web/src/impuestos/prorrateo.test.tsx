import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { DetallePosicionIva, type PosicionIvaWeb } from './PosicionIvaPage';

const envolver = (n: ReactNode) => render(<MantineProvider>{n}</MantineProvider>);
const base: PosicionIvaWeb = {
  anio: 2026, mes: 10, estado: 'BORRADOR', debito: { '21': '210.00' }, credito: { '21': '525.00' }, totalDebito: '210.00', totalCredito: '525.00',
  saldoTecnicoAnterior: '0.00', libreAnterior: '0.00', retenciones: '0.00', percepciones: '0.00', saldoTecnicoAFavor: '105.00', impuestoDeterminado: '0.00',
  impuestoAPagar: '0.00', libreDisponibilidad: '0.00', avisos: [], asientoId: null,
  coeficiente: null, creditoComun: null, creditoComputable: null, creditoNoComputable: null, ajusteProrrateo: null,
};

describe('prorrateo del crédito fiscal (web, E40)', () => {
  it('con prorrateo muestra computable, no computable, coeficiente y ajuste', () => {
    envolver(<DetallePosicionIva p={{ ...base, coeficiente: '0.5000', creditoComun: '210.00', creditoComputable: '315.00', creditoNoComputable: '210.00', ajusteProrrateo: '-105.00' }} />);
    expect(screen.getByText('Crédito fiscal computable')).toBeInTheDocument();
    expect(screen.getByText('Crédito fiscal no computable')).toBeInTheDocument();
    expect(screen.getByText('Coeficiente de prorrateo 0,5000')).toBeInTheDocument();
    expect(screen.getByText('Ajuste anual del prorrateo')).toBeInTheDocument();
  });

  it('sin ajuste no muestra su renglón; sin prorrateo no muestra nada', () => {
    const { unmount } = envolver(<DetallePosicionIva p={{ ...base, coeficiente: '0.5000', creditoComun: '210.00', creditoComputable: '315.00', creditoNoComputable: '210.00', ajusteProrrateo: '0.00' }} />);
    expect(screen.queryByText('Ajuste anual del prorrateo')).toBeNull();
    unmount();
    envolver(<DetallePosicionIva p={base} />);
    expect(screen.queryByText('Crédito fiscal computable')).toBeNull();
  });
});
