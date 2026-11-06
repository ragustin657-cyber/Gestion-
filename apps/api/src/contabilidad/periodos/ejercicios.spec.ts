import { mesesDe, rangoEjercicio } from './ejercicios';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('fechas de ejercicios', () => {
  it('ejercicio calendario', () => {
    const r = rangoEjercicio(1, d('2026-11-05'));
    expect([iso(r.desde), iso(r.hasta)]).toEqual(['2026-01-01', '2026-12-31']);
  });
  it('ejercicio que empieza en julio: bordes del 30/06 y 01/07', () => {
    const a = rangoEjercicio(7, d('2026-06-30'));
    expect([iso(a.desde), iso(a.hasta)]).toEqual(['2025-07-01', '2026-06-30']);
    const b = rangoEjercicio(7, d('2026-07-01'));
    expect([iso(b.desde), iso(b.hasta)]).toEqual(['2026-07-01', '2027-06-30']);
  });
  it('doce meses con sus fechas, febrero bisiesto incluido', () => {
    const m = mesesDe(d('2027-07-01'));
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ anio: 2027, mes: 7 });
    expect(iso(m[0].desde)).toBe('2027-07-01');
    expect(iso(m[0].hasta)).toBe('2027-07-31');
    const feb = m.find((x) => x.mes === 2)!;
    expect(feb.anio).toBe(2028);
    expect(iso(feb.hasta)).toBe('2028-02-29');
    expect(iso(m[11].hasta)).toBe('2028-06-30');
  });
});
