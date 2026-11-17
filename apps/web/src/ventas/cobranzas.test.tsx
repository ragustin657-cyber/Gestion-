import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { FormGestion, TablaAgenda } from './CobranzasPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const fila = {
  terceroId: 't1', cliente: 'Constructora Norte', vencido: '302500.00', porVencer: '0.00', aFavor: '0.00', dias: 45,
  ultimaGestion: { fecha: '2026-11-10', medio: 'LLAMADO', nota: 'Dijo que paga' }, proximaAccion: '2026-11-15', accionAtrasada: true,
  promesa: { fecha: '2026-11-14', importe: '100000.00', estado: 'INCUMPLIDA' as const },
};

describe('cobranzas (web)', () => {
  it('tabla de la agenda con marcas', () => {
    const elegidos: string[] = [];
    envolver(<TablaAgenda clientes={[fila]} onElegir={(id) => elegidos.push(id)} />);
    expect(screen.getByText('$ 302.500,00')).toBeTruthy();
    expect(screen.getByText('Incumplida')).toBeTruthy();
    expect(screen.getByText('Atrasada')).toBeTruthy();
    fireEvent.click(screen.getByText('Constructora Norte'));
    expect(elegidos).toEqual(['t1']);
  });

  it('formulario de gestión', () => {
    const enviados: unknown[] = [];
    envolver(<FormGestion onGuardar={(d) => enviados.push(d)} />);
    const boton = screen.getByRole('button', { name: 'Registrar gestión' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Llamé' } });
    fireEvent.change(screen.getByLabelText('Fecha de la promesa'), { target: { value: '2026-11-13' } });
    expect(boton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Importe prometido'), { target: { value: '1000' } });
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    expect(enviados).toEqual([expect.objectContaining({ nota: 'Llamé', promesaFecha: '2026-11-13', promesaImporte: 1000, medio: 'LLAMADO' })]);
  });

  it('menú con cualquiera de los dos permisos', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['cobranzas.gestionar']))).toContain('Cobranzas');
    expect(titulos(filtrarMenu(MENU, ['venta.ver']))).toContain('Cobranzas');
  });
});
