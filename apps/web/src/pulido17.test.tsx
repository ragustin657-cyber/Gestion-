import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FormEdicionBien } from './bienes-uso/BienesPage';
import { destinoPresupuesto, destinoTarjeta } from './informes/TableroPage';
import { puedeEditarPresupuesto } from './presupuestos/PresupuestosPage';
import { hastaPorDefecto } from './tesoreria/FlujoFondosPage';

describe('pulido 17 (web)', () => {
  it('la tarjeta de presupuesto abre el informe con su período', () => {
    expect(destinoPresupuesto({ desde: '2026-11', hasta: '2026-11' })).toBe('/informes/presupuesto-real?desde=2026-11&hasta=2026-11');
  });

  it('las tarjetas pasan "en moneda de hoy"', () => {
    expect(destinoTarjeta('/informes/ventas?x=1', true)).toBe('/informes/ventas?x=1&reexpresar=true');
    expect(destinoTarjeta('/informes/ventas?x=1', false)).toBe('/informes/ventas?x=1');
  });

  it('ejercicio cerrado en solo lectura', () => {
    expect(puedeEditarPresupuesto(true, { ejercicioCerrado: true })).toBe(false);
    expect(puedeEditarPresupuesto(true, { ejercicioCerrado: false })).toBe(true);
    expect(puedeEditarPresupuesto(false, { ejercicioCerrado: false })).toBe(false);
  });

  it('"hasta" del flujo con la fecha argentina', () => {
    vi.useFakeTimers({ now: new Date('2026-12-01T02:30:00Z'), toFake: ['Date'] }); // 30/11 23:30 en Argentina
    try {
      expect(hastaPorDefecto('semana')).toBe('2027-01-25');
    } finally {
      vi.useRealTimers();
    }
  });

  it('edición de un bien de factura: sin fecha ni valor', () => {
    render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><FormEdicionBien bien={{ id: 'b', origen: 'FACTURA', descripcion: 'Camioneta', vidaUtilMeses: 60, valorResidual: '0.00', fechaAlta: '2026-03-15', valorOrigen: '1200000.00' }} onGuardado={() => {}} /></MemoryRouter></QueryClientProvider></MantineProvider>);
    expect(screen.getByLabelText('Descripción')).toHaveValue('Camioneta');
    expect(screen.getByLabelText('Vida útil (meses)')).toBeInTheDocument();
    expect(screen.getByLabelText('Valor residual')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha de alta')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Valor de origen')).not.toBeInTheDocument();
  });
});
