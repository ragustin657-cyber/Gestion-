import { Prisma } from '@prisma/client';
import { Elemento, sugerir } from './sugerencias';

const D = (n: number) => new Prisma.Decimal(n);
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const el = (id: string, fecha: string, importe: number, referencia: string | null = null): Elemento => ({ id, fecha: f(fecha), importe: D(importe), referencia });

describe('sugerencias de conciliación', () => {
  it('exacta por referencia (sin ceros a la izquierda) y preseleccionada', () => {
    const r = sugerir([el('l1', '2026-10-12', 53000, 'DEP 0045')], [el('m1', '2026-10-11', 53000, '45'), el('m2', '2026-10-12', 53000, '99')], 5);
    expect(r).toEqual([{ lineas: ['l1'], movimientos: ['m1'], nivel: 'EXACTA', preseleccionada: true }]);
  });

  it('exacta por misma fecha; entre varios gana el de fecha más cercana', () => {
    const r = sugerir([el('l1', '2026-10-12', -500)], [el('m1', '2026-10-12', -500), el('m2', '2026-10-10', -500)], 5);
    expect(r[0]).toMatchObject({ movimientos: ['m1'], nivel: 'EXACTA' });
  });

  it('probable: mismo importe a pocos días y candidato único; fuera de tolerancia, nada', () => {
    expect(sugerir([el('l1', '2026-10-15', 1000)], [el('m1', '2026-10-12', 1000)], 5)).toEqual([{ lineas: ['l1'], movimientos: ['m1'], nivel: 'PROBABLE', preseleccionada: false }]);
    expect(sugerir([el('l1', '2026-10-20', 1000)], [el('m1', '2026-10-12', 1000)], 5)).toEqual([]);
  });

  it('probable sin candidato único no se propone', () => {
    expect(sugerir([el('l1', '2026-10-14', 1000)], [el('m1', '2026-10-12', 1000), el('m2', '2026-10-13', 1000)], 5)).toEqual([]);
  });

  it('agrupada: una línea contra varios movimientos de la misma fecha, y al revés', () => {
    const r = sugerir([el('l1', '2026-10-12', -30000)], [el('m1', '2026-10-12', -10000), el('m2', '2026-10-12', -15000), el('m3', '2026-10-12', -5000), el('m4', '2026-10-12', -7000)], 5);
    expect(r).toHaveLength(1);
    expect(r[0].nivel).toBe('AGRUPADA');
    expect(r[0].preseleccionada).toBe(false);
    expect(r[0].movimientos.sort()).toEqual(['m1', 'm2', 'm3']);
    const inv = sugerir([el('l1', '2026-10-12', 30000), el('l2', '2026-10-12', 23000)], [el('m1', '2026-10-12', 53000)], 5);
    expect(inv).toEqual([{ lineas: ['l1', 'l2'], movimientos: ['m1'], nivel: 'AGRUPADA', preseleccionada: false }]);
  });

  it('no reutiliza elementos entre pasadas', () => {
    const r = sugerir([el('l1', '2026-10-12', 100, '7'), el('l2', '2026-10-13', 100)], [el('m1', '2026-10-12', 100, '7')], 5);
    expect(r).toEqual([{ lineas: ['l1'], movimientos: ['m1'], nivel: 'EXACTA', preseleccionada: true }]);
  });
});
