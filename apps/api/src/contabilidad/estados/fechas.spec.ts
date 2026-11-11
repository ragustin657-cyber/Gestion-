import { unAnioAntes } from './fechas';

describe('unAnioAntes', () => {
  it('29/02 pasa al 28/02 del año anterior; el resto, la misma fecha', () => {
    expect(unAnioAntes(new Date('2028-02-29T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(unAnioAntes(new Date('2026-11-30T00:00:00Z')).toISOString().slice(0, 10)).toBe('2025-11-30');
  });
});
