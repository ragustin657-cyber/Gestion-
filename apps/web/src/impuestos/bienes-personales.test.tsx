import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { LiquidacionBp, PanelBp } from './BienesPersonalesPage';

const envolver = (n: ReactNode) => render(<MantineProvider><QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider></MantineProvider>);
const datos = (estado: 'BORRADOR' | 'PRESENTADA', avisos: string[] = []): LiquidacionBp => ({
  anio: 2026, estado, ejercicio: { numero: 1, desde: '2026-01-01', hasta: '2026-12-31', estado: 'CERRADO' }, ajuste: { importe: '0.00', concepto: null },
  liquidacion: {
    patrimonio: '10000000.00', ajuste: '0.00', base: '10000000.00', alicuota: '0.5', sumaParticipaciones: '100.0000', total: '35000.00', completo: !avisos.length, avisos,
    filas: [
      { socioId: 'a', nombre: 'Ana', documento: '20-1', tipoTitular: 'PERSONA_HUMANA_PAIS', porcentaje: '60.0000', paga: true, vpp: '6000000.00', impuesto: '30000.00' },
      { socioId: 'b', nombre: 'Inversora SA', documento: '30-1', tipoTitular: 'SOCIEDAD_PAIS', porcentaje: '30.0000', paga: false, vpp: '3000000.00', impuesto: '0.00' },
      { socioId: 'c', nombre: 'John', documento: 'X', tipoTitular: 'PERSONA_HUMANA_EXTERIOR', porcentaje: '10.0000', paga: true, vpp: '1000000.00', impuesto: '5000.00' },
    ],
  },
  presentaciones: estado === 'PRESENTADA' ? [{ numero: 0, presentadaEn: '2027-05-10T12:00:00Z', presentadaPor: 'u', anuladaEn: null, motivoAnulacion: null }] : [],
});

describe('Bienes Personales acciones y participaciones (web, E47)', () => {
  it('tabla por socio con el tipo en castellano, VPP, impuesto y total', () => {
    envolver(<PanelBp datos={datos('BORRADOR')} puedeEditar alCambiar={() => {}} />);
    expect(screen.getByText('Persona humana del país')).toBeInTheDocument();
    expect(screen.getByText('Sociedad del país (no paga)')).toBeInTheDocument();
    expect(screen.getByText('$ 6.000.000,00')).toBeInTheDocument();
    expect(screen.getAllByText('$ 35.000,00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Volver a copiar del registro' })).toBeInTheDocument();
  });

  it('aviso de participaciones incompletas', () => {
    envolver(<PanelBp datos={datos('BORRADOR', ['Las participaciones suman 90 %: deben sumar 100 %'])} puedeEditar alCambiar={() => {}} />);
    expect(screen.getByText('Las participaciones suman 90 %: deben sumar 100 %')).toBeInTheDocument();
  });

  it('presentada: sin edición y con anulación', () => {
    envolver(<PanelBp datos={datos('PRESENTADA')} puedeEditar alCambiar={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Guardar ajuste' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Volver a copiar del registro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anular presentación' })).toBeInTheDocument();
  });

  it('menú: socios y Bienes Personales con permiso de ver impuestos', () => {
    const rutas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [...(n.ruta ? [n.ruta] : []), ...rutas(n.hijos ?? [])]);
    expect(rutas(filtrarMenu(MENU, ['impuestos.ver']))).toEqual(expect.arrayContaining(['/impuestos/socios', '/impuestos/bienes-personales']));
  });
});
