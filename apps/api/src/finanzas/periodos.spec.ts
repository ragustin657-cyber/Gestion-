import { periodos } from './periodos';

const f = (s: string) => new Date(`${s}T00:00:00Z`);
const corto = (ps: ReturnType<typeof periodos>) => ps.map((p) => [p.desde.toISOString().slice(0, 10), p.hasta.toISOString().slice(0, 10), p.etiqueta]);

describe('cortes de períodos del flujo', () => {
  it('semanas de lunes a domingo, la primera desde hoy', () => {
    expect(corto(periodos(f('2026-11-06'), f('2026-11-29'), 'semana'))).toEqual([
      ['2026-11-06', '2026-11-08', '06/11–08/11'], ['2026-11-09', '2026-11-15', '09/11–15/11'],
      ['2026-11-16', '2026-11-22', '16/11–22/11'], ['2026-11-23', '2026-11-29', '23/11–29/11'],
    ]);
  });

  it('días', () => {
    expect(corto(periodos(f('2026-11-06'), f('2026-11-08'), 'dia')).map((p) => p[2])).toEqual(['06/11', '07/11', '08/11']);
  });

  it('meses cortados en hasta', () => {
    expect(corto(periodos(f('2026-11-06'), f('2027-01-15'), 'mes'))).toEqual([
      ['2026-11-06', '2026-11-30', 'nov 2026'], ['2026-12-01', '2026-12-31', 'dic 2026'], ['2027-01-01', '2027-01-15', 'ene 2027'],
    ]);
  });

  it('un solo día en domingo', () => {
    expect(corto(periodos(f('2026-11-08'), f('2026-11-08'), 'semana'))).toEqual([['2026-11-08', '2026-11-08', '08/11–08/11']]);
  });
});
