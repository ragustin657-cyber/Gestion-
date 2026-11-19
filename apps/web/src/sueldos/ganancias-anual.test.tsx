import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { CamposExentoGanancias, cambiarClase, faltaRubroExento } from './ConceptosPage';
import { TablaAnualGanancias } from './GananciasAnualPage';
import { EditorPagosACuenta, HojaGananciasVista, type HojaGanancias } from './GananciasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const hojaBase = { mes: 12, bruta: '30000000.00', aportes: '5000000.00', gananciaNeta: '25000000.00', deducciones: [{ tipo: 'CUOTAS_MEDICAS', nombre: 'Cuotas médicas', informado: '1000000', computado: '1000000.00' }], personales: { gni: '4000000.00', especial: '15000000.00', cargas: '0.00' }, sujeta: '5000000.00', tramo: { desde: '0', fijo: '0', porcentaje: '10.00' }, impuesto: '500000.00', retenidoAnterior: '450000.00', pagosACuenta: '0.00', calculado: '50000.00', topeMes: '0.00', importe: '50000.00', noRetenido: '0.00', avisos: [] };
const fila = (o: Record<string, unknown> = {}) => ({ empleadoId: 'e1', legajo: 1, apellido: 'Pérez', nombre: 'Juan', distracto: false, hoja: hojaBase, impuesto: '500000.00', retenido: '450000.00', pagosACuenta: '0.00', saldo: '50000.00', ...o });

describe('Ganancias: liquidación anual (web)', () => {
  it('tabla de la anual con saldo a retener y a devolver', () => {
    envolver(<TablaAnualGanancias filas={[fila(), fila({ empleadoId: 'e2', legajo: 2, apellido: 'Ruiz', nombre: 'Ana', saldo: '-20000.00' })]} />);
    expect(screen.getByText('Pérez, Juan')).toBeTruthy();
    expect(screen.getByText('$ 50.000,00')).toBeTruthy();
    expect(screen.getByText('Devolución $ 20.000,00')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('bruta, deducciones y la hoja de cada empleado', async () => {
    envolver(<TablaAnualGanancias filas={[fila()]} />);
    expect(screen.getAllByText('$ 30.000.000,00').length).toBeGreaterThan(0);
    // Deducciones: aportes + generales + art. 30 = 5 + 1 + 4 + 15 millones
    expect(screen.getAllByText('$ 25.000.000,00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ver hoja de Pérez, Juan' }));
    expect(await screen.findByText('Ganancia sujeta a impuesto')).toBeTruthy();
  });

  it('aviso de final cerrada en la fila', () => {
    envolver(<TablaAnualGanancias filas={[fila({ aviso: 'Su final ya está cerrada: el saldo se retiene o devuelve fuera del sistema' })]} />);
    expect(screen.getByText('Su final ya está cerrada: el saldo se retiene o devuelve fuera del sistema')).toBeTruthy();
  });

  it('rubro exento obligatorio', () => {
    expect(faltaRubroExento({ exentoGanancias: true, rubroExentoGanancias: null })).toBe(true);
    expect(faltaRubroExento({ exentoGanancias: true, rubroExentoGanancias: 'INDUMENTARIA' })).toBe(false);
    expect(faltaRubroExento({ exentoGanancias: false, rubroExentoGanancias: null })).toBe(false);
    const cambios: unknown[] = [];
    envolver(<CamposExentoGanancias exento rubro={null} onChange={(c) => cambios.push(c)} />);
    expect(screen.getByRole('textbox', { name: 'Rubro exento (F.1359)' })).toBeTruthy();
  });

  it('pasar a descuento desmarca exento', () => {
    const f = cambiarClase({ codigo: '900', nombre: 'Viático', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: '{}', orden: 900, soloAfiliados: false, activo: true, destino: 'OTRO', cuentaContableId: null, codigoArca: '', exentoGanancias: true, rubroExentoGanancias: null }, 'DESCUENTO');
    expect([f.clase, f.exentoGanancias, f.rubroExentoGanancias, faltaRubroExento(f)]).toEqual(['DESCUENTO', false, null, false]);
  });

  it('editor de pagos a cuenta', () => {
    const cambios: unknown[][] = [];
    envolver(<EditorPagosACuenta pagos={[]} onChange={(p) => cambios.push(p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar pago a cuenta' }));
    expect(cambios[0]).toEqual([{ tipo: 'DOLAR_ATESORAMIENTO', codigo: '', meses: [{ mes: 1, importe: '0' }] }]);
  });

  it('la hoja muestra los pagos a cuenta', () => {
    const hoja = { mes: 11, bruta: '1', aportes: '0', gananciaNeta: '1', deducciones: [], personales: { gni: '0', especial: '0', cargas: '0' }, sujeta: '1', tramo: { desde: '0', fijo: '0', porcentaje: '5.00' }, impuesto: '1', retenidoAnterior: '0', pagosACuenta: '50000.00', calculado: '0', topeMes: '0', importe: '0', noRetenido: '0', avisos: [] } as HojaGanancias;
    envolver(<HojaGananciasVista hoja={hoja} />);
    expect(screen.getByText('Pagos a cuenta')).toBeTruthy();
  });
});
