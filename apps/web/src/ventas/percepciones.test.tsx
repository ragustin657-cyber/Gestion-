import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ReactNode } from 'react';
import { TablaJurisdiccionesIibb } from '../pagos/ConfigRetencionesPage';
import { cuerpoGenerar, quincenasPara, TIPOS_PRESENTACION } from '../impuestos/comun';
import { GrillaVenta, etiquetaPercepcion } from './GrillaVenta';
import { ALICUOTAS_DESPACHO } from '../compras/DespachoImportacionPage';
import { renglonesCambiaron } from './ComprobanteVentaPage';

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

  it('pulido E42: con renglones cambiados no suma las percepciones guardadas y avisa', () => {
    envolver(<GrillaVenta letra="A" moneda="ARS" articulos={[]} onChange={() => undefined} percepcionesDesactualizadas
      renglones={[{ articuloId: null, descripcion: 'P', cantidad: '1', precioUnitario: '100', alicuota: '21' }]}
      percepciones={[{ tipo: 'IIBB', jurisdiccion: '902', alicuota: '3', importe: '30', origenAlicuota: 'PADRON' }]} />);
    expect(screen.getByText('Las percepciones se recalculan al guardar')).toBeInTheDocument();
    expect(screen.getByTestId('total-venta')).toHaveTextContent('Total $ 121,00');
  });

  it('pulido E42: dos percepciones de IVA con la misma alícuota y distinto tramo no repiten clave', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    envolver(<GrillaVenta letra="A" moneda="ARS" articulos={[]} onChange={() => undefined}
      renglones={[{ articuloId: null, descripcion: 'P', cantidad: '1', precioUnitario: '100', alicuota: '21' }]}
      percepciones={[{ tipo: 'IVA', jurisdiccion: null, tramo: 'GENERAL', alicuota: '3', importe: '3', origenAlicuota: 'REGIMEN' }, { tipo: 'IVA', jurisdiccion: null, tramo: 'REDUCIDA', alicuota: '3', importe: '1', origenAlicuota: 'REGIMEN' }]} />);
    expect(error.mock.calls.some((c: unknown[]) => String(c[0]).includes('same key'))).toBe(false);
    error.mockRestore();
  });

  it('pulido E42: el despacho ofrece solo 21 % y 10,5 %', () => {
    expect(ALICUOTAS_DESPACHO.map((a) => a.value)).toEqual(['21', '10.5']);
  });

  it('revisión E42: un precio con separador de miles o una descripción con espacios no marca las percepciones como viejas', () => {
    const guardado = { renglones: [{ id: 'r1', articuloId: null, descripcion: 'Servicio', cantidad: '1', precioUnitario: '1234.5', alicuota: '21', neto: '1234.5', iva: '259.25' }] } as never;
    expect(renglonesCambiaron([{ articuloId: null, descripcion: 'Servicio ', cantidad: '1', precioUnitario: '1.234,50', alicuota: '21' }], guardado)).toBe(false);
    expect(renglonesCambiaron([{ articuloId: null, descripcion: 'Servicio', cantidad: '1', precioUnitario: '1.300,00', alicuota: '21' }], guardado)).toBe(true);
  });
});
