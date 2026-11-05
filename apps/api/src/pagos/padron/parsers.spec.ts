import { parsearLineaAgip, parsearLineaArba } from './parsers';

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
