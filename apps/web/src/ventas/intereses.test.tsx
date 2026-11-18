import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { filtrarMenu, MENU, NodoMenu } from '../layout/menu';
import { GrupoIntereses, TablaIntereses } from './InteresesPages';

const envolver = (n: ReactNode) => render(<MantineProvider><MemoryRouter>{n}</MemoryRouter></MantineProvider>);
const grupos: GrupoIntereses[] = [
  { terceroId: 't1', cliente: 'Norte SA', monedaCodigo: 'ARS', total: '77.35', renglones: [
    { comprobanteId: 'f1', comprobante: 'FC A 0001-00000001', vencimiento: '2026-10-10', saldo: '1210.00', dias: 21, interes: '42.35', alicuota: '21' },
    { comprobanteId: 'f2', comprobante: 'FC A 0001-00000002', vencimiento: '2026-10-10', saldo: '1000.00', dias: 21, interes: '35.00', alicuota: '21' },
  ] },
  { terceroId: 't2', cliente: 'Sur SRL', monedaCodigo: 'ARS', total: '10.00', renglones: [
    { comprobanteId: 'f3', comprobante: 'FC B 0001-00000003', vencimiento: '2026-10-20', saldo: '600.00', dias: 11, interes: '10.00', alicuota: '21' },
  ] },
];

function Controlada({ onCambio }: { onCambio: (x: string[]) => void }) {
  const [excluidos, setExcluidos] = useState<string[]>([]);
  return <TablaIntereses grupos={grupos} excluidos={excluidos} onCambiar={(x) => { setExcluidos(x); onCambio(x); }} />;
}

describe('intereses (web)', () => {
  it('total seleccionado y destildar un cliente', () => {
    const cambios: string[][] = [];
    envolver(<Controlada onCambio={(x) => cambios.push(x)} />);
    expect(screen.getByTestId('total-intereses').textContent).toBe('Total a facturar $ 87,35');
    fireEvent.click(screen.getByLabelText('Cliente Norte SA'));
    expect(cambios.at(-1)!.sort()).toEqual(['f1', 'f2']);
    expect(screen.getByTestId('total-intereses').textContent).toBe('Total a facturar $ 10,00');
    fireEvent.click(screen.getByLabelText('Factura FC B 0001-00000003'));
    expect(screen.getByTestId('total-intereses').textContent).toBe('Total a facturar $ 0,00');
  });

  it('menú', () => {
    const titulos = (m: NodoMenu[]): string[] => m.flatMap((n) => [n.titulo, ...titulos(n.hijos ?? [])]);
    expect(titulos(filtrarMenu(MENU, ['intereses.liquidar']))).toContain('Intereses por mora');
  });
});
