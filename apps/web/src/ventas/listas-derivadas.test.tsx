import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { CamposRegla, cuerpoRecalculo, elegidosIniciales, TablaRecalculo } from './listas-derivadas';

const envolver = (n: React.ReactNode) => render(<MantineProvider>{n}</MantineProvider>);
const filas = [
  { articuloId: 'a', codigo: 'A1', descripcion: 'Uno', actual: '1000', nuevo: '1100', variacionPct: '10', motivo: null },
  { articuloId: 'b', codigo: 'A2', descripcion: 'Dos', actual: '999', nuevo: null, variacionPct: null, motivo: 'Precio fijo' },
  { articuloId: 'c', codigo: 'A3', descripcion: 'Tres', actual: null, nuevo: '500', variacionPct: null, motivo: null },
];

describe('listas derivadas (web, E52)', () => {
  it('campos de la regla según la base', () => {
    const listas = [{ id: 'l1', nombre: 'Minorista' }];
    const { unmount } = envolver(<CamposRegla regla={{ base: 'LISTA', listaBaseId: null, porcentaje: '', redondeo: '1' }} onChange={() => {}} listas={listas} />);
    expect(screen.getAllByLabelText('Lista base')[0]).toBeInTheDocument();
    expect(screen.getByLabelText('Porcentaje (+ recargo / − descuento)')).toBeInTheDocument();
    unmount();
    const { unmount: u2 } = envolver(<CamposRegla regla={{ base: 'COSTO', listaBaseId: null, porcentaje: '30', redondeo: '1' }} onChange={() => {}} listas={listas} />);
    expect(screen.queryByLabelText('Lista base')).toBeNull();
    expect(screen.getByLabelText('Margen sobre el costo (%)')).toBeInTheDocument();
    u2();
    envolver(<CamposRegla regla={{ base: 'MANUAL', listaBaseId: null, porcentaje: '', redondeo: '0.01' }} onChange={() => {}} listas={listas} />);
    expect(screen.queryByLabelText('Margen sobre el costo (%)')).toBeNull();
  });

  it('vista previa: se eligen las que se recalculan; aplicar manda solo las elegidas', () => {
    const elegidos = elegidosIniciales(filas);
    expect([...elegidos].sort()).toEqual(['a', 'c']);
    envolver(<TablaRecalculo filas={filas} elegidos={elegidos} onChange={() => {}} moneda="ARS" />);
    expect(screen.getByLabelText('Recalcular A1')).toBeChecked();
    expect(screen.getByLabelText('Recalcular A2')).toBeDisabled();
    expect(screen.getByText('Precio fijo')).toBeInTheDocument();
    expect(cuerpoRecalculo(filas, elegidos)).toEqual({});
    expect(cuerpoRecalculo(filas, new Set(['a']))).toEqual({ articuloIds: ['a'] });
  });
});
