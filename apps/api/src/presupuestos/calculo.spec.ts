import { Prisma } from '@prisma/client';
import { repartir } from './calculo';

const meses = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

describe('repartir', () => {
  it('partes iguales', () => {
    expect(Object.values(repartir(new Prisma.Decimal(120000), meses)).map((v) => v.toFixed(2))).toEqual(Array(12).fill('10000.00'));
  });
  it('el último mes absorbe el redondeo', () => {
    const r = Object.values(repartir(new Prisma.Decimal(100000), meses)).map((v) => v.toFixed(2));
    expect(r.slice(0, 11)).toEqual(Array(11).fill('8333.33'));
    expect(r[11]).toBe('8333.37');
  });
});
