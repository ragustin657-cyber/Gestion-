import { parsearLineaAgip, parsearLineaArba , parsearLineaConFormato } from './parsers';

describe('parsers de padrón', () => {
  it('ARBA retención con coma decimal', () => {
    expect(parsearLineaArba('R;01102026;01112026;30112026;30700123452;D;N;N;1,75;0', 1)).toEqual({
      cuit: '30700123452', vigenciaDesde: new Date('2026-11-01T00:00:00Z'), vigenciaHasta: new Date('2026-11-30T00:00:00Z'),
      alicuotaRetencion: '1.75', alicuotaPercepcion: null,
    });
  });
  it('ARBA percepción', () => expect(parsearLineaArba('P;01102026;01112026;30112026;30700123452;D;N;N;2,00;0', 1)).toMatchObject({ alicuotaPercepcion: '2.00', alicuotaRetencion: null }));
  it('ARBA CUIT de 10 dígitos → error con número de línea', () =>
    expect(() => parsearLineaArba('R;01102026;01112026;30112026;3070012345;D;N;N;1,75;0', 3)).toThrow('Línea 3 inválida'));
  it('ARBA fecha inválida → error', () => expect(() => parsearLineaArba('R;01102026;32112026;30112026;30700123452;D;N;N;1,75;0', 2)).toThrow('Línea 2 inválida'));
  it('AGIP percepción y retención', () =>
    expect(parsearLineaAgip('01102026;01112026;30112026;30700123452;D;S;N;3,00;2,50;0;0;DISTRIBUIDORA', 1)).toMatchObject({ alicuotaPercepcion: '3.00', alicuotaRetencion: '2.50' }));
  it('línea vacía → null', () => {
    expect(parsearLineaArba('', 1)).toBeNull();
    expect(parsearLineaAgip('   \r', 1)).toBeNull();
  });
});

describe('padrón con formato configurable (E48)', () => {
  const base = { jurisdiccion: '904', separador: ';', encabezado: true, cuit: '1', alicuotaRetencion: '2', alicuotaPercepcion: '3', vigenciaDesde: '4', vigenciaHasta: '5', formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',' };
  it('separador, decimal con coma y vigencia', () => {
    expect(parsearLineaConFormato('20123456786;1,5;2,25;01/11/2026;30/11/2026', 2, base)).toEqual({
      cuit: '20123456786', alicuotaRetencion: '1.5', alicuotaPercepcion: '2.25', vigenciaDesde: new Date('2026-11-01T00:00:00Z'), vigenciaHasta: new Date('2026-11-30T00:00:00Z'),
    });
    expect(parsearLineaConFormato('   ', 3, base)).toBeNull();
  });
  it('ancho fijo sin vigencia: la del período', () => {
    const f = { ...base, separador: 'FIJO', encabezado: false, cuit: '1-11', alicuotaRetencion: null, alicuotaPercepcion: '12-17', vigenciaDesde: null, vigenciaHasta: null, separadorDecimal: '.' };
    expect(parsearLineaConFormato('20123456786  3.50', 1, f, '202611')).toEqual({
      cuit: '20123456786', alicuotaRetencion: null, alicuotaPercepcion: '3.50', vigenciaDesde: new Date('2026-11-01T00:00:00Z'), vigenciaHasta: new Date('2026-11-30T00:00:00Z'),
    });
  });
  it('CUIT inválido: error con el número de línea', () => {
    expect(() => parsearLineaConFormato('2012;1,5;2;01/11/2026;30/11/2026', 3, base)).toThrow('Línea 3 inválida: CUIT');
  });
});
