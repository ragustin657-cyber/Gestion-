import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { TablaJurisdiccionesIibb } from '../pagos/ConfigRetencionesPage';
import { cuerpoGenerar, quincenasPara, TIPOS_PRESENTACION } from '../impuestos/comun';
import { GrillaVenta, etiquetaPercepcion } from './GrillaVenta';

const envolver = (n: ReactNode) => render(<MantineProvider>{n}</MantineProvider>);

describe('percepciones en ventas (web, E39)', () => {
  it('la grilla muestra las percepciones con su origen y el total las incluye', () => {
    envolver(<GrillaVenta letra="A" moneda="ARS" articulos={[]} onChange={() => undefined}
      renglones={[{ articuloId: null, descripcion: 'P', cantidad: '1', precioUnitario: '1000', alicuota: '21' }]}
      percepciones={[{ tipo: 'IIBB', jurisdiccion: '902', alicuota: '3', importe: '30', origenAlicuota: 'PADRON' }]} />);
    expect(screen.getByText('Percepción IIBB 902 Buenos Aires 3 % (padrón)')).toBeInTheDocument();
    expect(screen.getByTestId('total-venta')).toHaveTextContent('Total $ 1.240,00');
  });

  it('etiqueta de la percepción de IVA', () => {
    expect(etiquetaPercepcion({ tipo: 'IVA', jurisdiccion: null, alicuota: '1.5', importe: '15', origenAlicuota: 'REGIMEN' })).toBe('Percepción IVA 1,5 % (régimen)');
  });

  it('configuración de IIBB con los campos de percepción', () => {
    envolver(<TablaJurisdiccionesIibb onCambiar={() => undefined} filas={[{ jurisdiccion: '902', alicuotaDefecto: '0', minimoRetencion: '0', usaPadron: true, sinPadron: 'NO_RETENER', percibe: true, alicuotaPercepcionDefecto: '3', minimoPercepcion: '0', sinPadronPercepcion: 'NO_RETENER' }]} />);
    expect(screen.getByText('Percibe')).toBeInTheDocument();
    expect(screen.getByLabelText('Alícuota de percepción por defecto')).toBeInTheDocument();
  });

  it('presentación de percepciones de ARBA con quincena', () => {
    expect(TIPOS_PRESENTACION.some((t) => t.value === 'ARBA_PERCEPCIONES')).toBe(true);
    expect(quincenasPara('ARBA_PERCEPCIONES', 'QUINCENAL')).toHaveLength(2);
    expect(cuerpoGenerar('ARBA_PERCEPCIONES', '2026', '11', '2')).toEqual({ tipo: 'ARBA_PERCEPCIONES', periodo: '202611', quincena: 2 });
  });
});
