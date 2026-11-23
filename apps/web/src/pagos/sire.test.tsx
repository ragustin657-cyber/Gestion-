import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { NOMBRE_PRESENTACION } from '../impuestos/comun';
import { camposImpuestos } from '../paginas/TercerosPage';
import { RegimenesExterior } from './ConfigRetencionesPage';
import { RetencionesPage } from './RetencionesPage';
import { descripcionRetencion, numeroCertificado } from './tipos';

const envolver = (ui: React.ReactNode) => render(
  <MantineProvider><QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter>
  </QueryClientProvider></MantineProvider>,
);
const fila = (o: Record<string, unknown>) => ({
  id: 'x', ordenPagoId: 'op', fechaPago: '2026-11-06', certificado: 'RET-IVA 00000001', impuesto: 'IVA', jurisdiccion: null, regimen: 'Compraventa', razonSocial: 'Proveedor',
  cuit: '30-00000000-0', base: '1000', alicuota: '50', importe: '105', ordenPagoNumero: '0001-00000001', anulada: false, certificadoSire: null, ...o,
});

describe('SIRE completo (web, E43)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retenciones practicadas: certificado SIRE editable en IVA y Ganancias exterior, no en Ganancias local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      fila({ id: 'a', certificadoSire: 'SIRE-1' }),
      fila({ id: 'b', impuesto: 'GANANCIAS', certificado: 'RET-GAN 00000001', regimen: '94', alicuota: '2' }),
      fila({ id: 'c', impuesto: 'GANANCIAS_EXTERIOR', certificado: 'RET-GAN-EXT 00000001', regimen: 'Honorarios del exterior', alicuota: '31.5' }),
    ]), { status: 200 })));
    envolver(<RetencionesPage />);
    expect(await screen.findByText('Certificado SIRE')).toBeInTheDocument();
    const campos = await screen.findAllByLabelText(/^Certificado SIRE de /);
    expect(campos.map((c) => c.getAttribute('aria-label'))).toEqual(['Certificado SIRE de RET-IVA 00000001', 'Certificado SIRE de RET-GAN-EXT 00000001']);
    expect((campos[0] as HTMLInputElement).value).toBe('SIRE-1');
    expect(screen.getByText(/Ganancias exterior \(Honorarios del exterior\)/)).toBeInTheDocument();
  });

  it('presentaciones nuevas', () => {
    expect([NOMBRE_PRESENTACION.SIRE_GANANCIAS_EXTERIOR, NOMBRE_PRESENTACION.SIRE_IVA_ANULACIONES]).toEqual(['SIRE Ganancias exterior (F.2003)', 'SIRE IVA anulaciones (F.2005)']);
  });

  it('retención al exterior: descripción y certificado', () => {
    const r = { impuesto: 'GANANCIAS_EXTERIOR' as const, jurisdiccion: null, regimen: 'x', certificadoNumero: 2, detalle: { codigoSire: '160' } };
    expect(descripcionRetencion(r)).toBe('Ganancias exterior (régimen 160)');
    expect(numeroCertificado(r)).toBe('RET-GAN-EXT 00000002');
  });

  it('ficha del proveedor con los datos del exterior', () => {
    const campos = camposImpuestos([], [], [], [{ id: 'e1', descripcion: 'Honorarios del exterior' }]).map((c) => c.nombre);
    expect(campos).toEqual(expect.arrayContaining(['residenteExterior', 'nif', 'paisSire', 'domicilioExterior', 'tipoPersona', 'nacimientoPais', 'nacimientoFecha', 'regimenExteriorId', 'aplicaCdi', 'acrecentamiento']));
  });

  it('configuración: regímenes de Ganancias exterior', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'r1', codigoSire: '160', descripcion: 'Honorarios del exterior', alicuotaSinCdi: '31.5', codigoAlicuotaSinCdi: 100, alicuotaConCdi: null, codigoAlicuotaConCdi: null, activo: true },
    ]), { status: 200 })));
    envolver(<RegimenesExterior />);
    expect(await screen.findByText('Honorarios del exterior')).toBeInTheDocument();
    expect(screen.getByText('31,5 %')).toBeInTheDocument();
  });
});

describe('revisión E43: aviso del proveedor del exterior sin régimen', () => {
  it('la tabla de retenciones de la orden muestra el aviso de la fila en cero', async () => {
    const { TablaRetenciones } = await import('./TablaRetenciones');
    render(<MantineProvider><TablaRetenciones retenciones={[{ id: 'r', impuesto: 'GANANCIAS_EXTERIOR', jurisdiccion: null, regimen: null, base: '1000', alicuota: '0', importe: '0', detalle: { aviso: 'El proveedor del exterior ACME no tiene régimen de Ganancias exterior' }, certificadoNumero: null, anulada: false }]} /></MantineProvider>);
    expect(screen.getByText('El proveedor del exterior ACME no tiene régimen de Ganancias exterior')).toBeInTheDocument();
  });

  it('pulido E49: retención al exterior asumida por la empresa; códigos sin formato de moneda', async () => {
    const { TablaRetenciones, textoDetalle } = await import('./TablaRetenciones');
    const detalle = { codigoSire: '160', codigoAlicuota: '100', aplicaCdi: 'false', acrecentamiento: 'true', basePago: '1000' };
    render(<MantineProvider><TablaRetenciones retenciones={[{ id: 'r', impuesto: 'GANANCIAS_EXTERIOR', jurisdiccion: null, regimen: 'x', base: '1000', alicuota: '31.5', importe: '315', detalle, certificadoNumero: 1, anulada: false }]} /></MantineProvider>);
    expect(screen.getByText('Ganancias exterior (régimen 160) (asumida por la empresa)')).toBeInTheDocument();
    const t = textoDetalle(detalle);
    expect(t).not.toContain('$ 160');
    expect(t).not.toContain('$ 100');
    expect(t).toContain('No');
    expect(t).toContain('Sí');
    expect(t).toContain('$ 1.000,00');
  });
});

