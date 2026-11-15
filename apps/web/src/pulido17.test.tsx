import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('pulido 17: correcciones de la revisión (web)', () => {
  const envolverForm = (bien: Parameters<typeof FormEdicionBien>[0]['bien'], conAmortizaciones = false) =>
    render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter><FormEdicionBien bien={bien} conAmortizaciones={conAmortizaciones} onGuardado={() => {}} /></MemoryRouter></QueryClientProvider></MantineProvider>);
  const bienManual = { id: 'b', origen: 'MANUAL', descripcion: 'Auto', vidaUtilMeses: 60, valorResidual: '1500.50', fechaAlta: '2026-03-15', valorOrigen: '1234567.89' };

  it('guardar sin tocar los importes no los cambia y solo envía lo modificado', async () => {
    const cuerpos: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: { body: string }) => { cuerpos.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }); }));
    envolverForm(bienManual);
    expect(screen.getByLabelText('Valor residual')).toHaveValue('1.500,5');
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Auto 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(cuerpos).toEqual([{ descripcion: 'Auto 2' }]));
    vi.unstubAllGlobals();
  });

  it('con amortizaciones solo se edita la descripción', () => {
    envolverForm(bienManual, true);
    expect(screen.getByLabelText('Vida útil (meses)')).toBeDisabled();
    expect(screen.getByLabelText('Valor residual')).toBeDisabled();
  });

  it('la tarjeta lleva el presupuesto', () => {
    expect(destinoPresupuesto({ id: 'p1', desde: '2026-11', hasta: '2026-11' })).toBe('/informes/presupuesto-real?id=p1&desde=2026-11&hasta=2026-11');
  });
});
