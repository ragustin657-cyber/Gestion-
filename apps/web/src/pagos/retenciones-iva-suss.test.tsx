import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { camposImpuestos } from '../paginas/TercerosPage';
import { NOMBRE_PRESENTACION } from '../impuestos/comun';
import { RegimenesSire } from './ConfigRetencionesPage';
import { descripcionRetencion, numeroCertificado } from './tipos';

describe('retenciones de IVA y SUSS (web)', () => {
  it('regímenes de IVA con el aviso de código SIRE faltante', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'r1', codigoSire: null, descripcion: 'Compraventa de cosas muebles', porcentaje: '50', minimoComprobante: '0', minimoRetencion: '0', condicionSire: null, activo: true, aviso: 'Cargue el código SIRE del régimen Compraventa de cosas muebles' },
    ]), { status: 200 })));
    render(
      <MantineProvider><QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AuthProvider><RegimenesSire impuesto="IVA" /></AuthProvider></MemoryRouter>
      </QueryClientProvider></MantineProvider>,
    );
    expect(await screen.findByText('Cargue el código SIRE del régimen Compraventa de cosas muebles')).toBeInTheDocument();
  });

  it('retención de IVA con la factura y su certificado', () => {
    const r = { impuesto: 'IVA' as const, jurisdiccion: null, regimen: 'x', certificadoNumero: 3, detalle: { letra: 'A', puntoVenta: '3', numero: '5001' } };
    expect(descripcionRetencion(r)).toBe('IVA factura A 00003-00005001');
    expect(numeroCertificado(r)).toBe('RET-IVA 00000003');
  });

  it('ficha del proveedor con regímenes de IVA y SUSS y exclusión', () => {
    const campos = camposImpuestos([], [{ id: 'i1', descripcion: 'Compraventa' }], [{ id: 's1', descripcion: 'Limpieza' }]).map((c) => c.nombre);
    expect(campos).toEqual(expect.arrayContaining(['regimenIvaId', 'regimenSussId', 'exclusionIvaPorcentaje', 'exclusionIvaPublicacion', 'exclusionIvaHasta']));
  });

  it('presentaciones SIRE', () => {
    expect([NOMBRE_PRESENTACION.SIRE_IVA, NOMBRE_PRESENTACION.SIRE_SUSS]).toEqual(['SIRE IVA (F.2005)', 'SIRE SUSS (F.2004)']);
  });
});
