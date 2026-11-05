import { describe, it, expect } from 'vitest';
import { hoyEn } from './fechas';

describe('hoyEn', () => {
  it('a las 22:30 de Argentina sigue siendo el mismo día', () =>
    expect(hoyEn('America/Argentina/Buenos_Aires', new Date('2026-11-06T01:30:00Z'))).toBe('2026-11-05'));
  it('en UTC ya es el día siguiente', () => expect(hoyEn('UTC', new Date('2026-11-06T01:30:00Z'))).toBe('2026-11-06'));
});
