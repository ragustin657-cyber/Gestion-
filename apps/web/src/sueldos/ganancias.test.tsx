import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { FormTablaGanancias, HojaGananciasVista, ResultadoImportacionF572, tramosValidos, type TablaGananciasWeb } from './GananciasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const tabla: TablaGananciasWeb = {
  gni: '1200000.00', deduccionEspecial: '4800000.00', conyuge: '1200000.00', hijo: '600000.00', hijoIncapacitado: '1200000.00',
  topes: { hipotecario: '120000.00', seguroMuerte: '60000.00', seguroMixto: '60000.00', seguroRetiro: '60000.00', sepelio: '12000.00' },
  tramos: [{ desde: '0.00', hasta: '1200000.00', fijo: '0.00', porcentaje: '5.0000' }, { desde: '1200000.00', hasta: null, fijo: '60000.00', porcentaje: '10.0000' }],
};
const hoja = {
  mes: 11, bruta: '30000000.00', aportes: '5000000.00', gananciaNeta: '25000000.00', deducciones: [{ tipo: 'ALQUILER', nombre: 'Alquiler de casa habitación', informado: '500000.00', computado: '200000.00' }],
  personales: { gni: '1100000.00', especial: '4400000.00', cargas: '0.00' }, sujeta: '19300000.00', tramo: { desde: '2200000.00', fijo: '165000.00', porcentaje: '15.00' }, impuesto: '2730000.00',
  retenidoAnterior: '2000000.00', calculado: '730000.00', topeMes: '10500000.00', importe: '730000.00', noRetenido: '0.00', avisos: ['Otra deducción: 10.000,00 informado que no es deducible en este régimen'],
};

describe('Ganancias de cuarta (web)', () => {
  it('validación de tramos', () => {
    expect(tramosValidos(tabla.tramos)).toBeNull();
    expect(tramosValidos([{ ...tabla.tramos[0], desde: '10' }, tabla.tramos[1]])).toBe('El primer tramo empieza en 0');
    expect(tramosValidos([tabla.tramos[0], { ...tabla.tramos[1], desde: '1300000' }])).toBe('Los tramos deben ser consecutivos');
    expect(tramosValidos([tabla.tramos[0], { ...tabla.tramos[1], hasta: '9000000' }])).toBe('El último tramo no tiene límite');
  });

  it('formulario de la tabla agrega y quita tramos', () => {
    const guardar = vi.fn();
    envolver(<FormTablaGanancias inicial={tabla} onGuardar={guardar} />);
    expect(screen.getAllByLabelText(/^Desde tramo/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tramo' }));
    expect(screen.getAllByLabelText(/^Desde tramo/)).toHaveLength(3);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar tramo 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ gni: 1200000, tramos: [{ desde: 0, hasta: 1200000, fijo: 0, porcentaje: 5 }, { desde: 1200000, hasta: null, fijo: 60000, porcentaje: 10 }] }));
  });

  it('hoja de cálculo', () => {
    envolver(<HojaGananciasVista hoja={hoja} />);
    expect(screen.getByText('Ganancia sujeta a impuesto')).toBeTruthy();
    expect(screen.getByText('Retención del mes')).toBeTruthy();
    expect(screen.getByText('$ 730.000,00')).toBeTruthy();
    expect(screen.getByText(/15,00 % sobre el excedente de \$ 2\.200\.000,00/)).toBeTruthy();
    expect(screen.getByText(/no es deducible/)).toBeTruthy();
  });

  it('resultado de la importación', () => {
    const confirmar = vi.fn();
    envolver(<ResultadoImportacionF572 resultado={{ importados: [{ archivo: 'a.xml', empleado: 'Pérez, Juan', avisos: ['Deducción con código 99'] }], omitidos: [{ archivo: 'b.xml', motivo: 'Empleado inexistente (CUIL 20111111112)' }], pendientes: [{ archivo: 'c.xml', empleado: 'Ruiz, Ana' }] }} onConfirmar={confirmar} />);
    expect(screen.getByText('b.xml: Empleado inexistente (CUIL 20111111112)')).toBeTruthy();
    expect(screen.getByText(/Deducción con código 99/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reemplazo' }));
    expect(confirmar).toHaveBeenCalled();
  });
});
