import { Prisma } from '@prisma/client';
import { aumentar } from './aumento';
import { precioDerivado, redondear } from './derivadas';

const D = Prisma.Decimal;
describe('precios derivados (E52)', () => {
  it('desde otra lista o desde el costo, con redondeo', () => {
    expect(precioDerivado(new D(1000), new D(-10), '1').toString()).toBe('900');
    expect(precioDerivado(new D(1234.56), new D(30), '10').toString()).toBe('1600');
    expect(precioDerivado(new D(1), new D(30), '0.01').toString()).toBe('1.3');
  });
  it('redondear es el mismo criterio del aumento masivo', () => {
    for (const [p, pct, r] of [[2500, 7.3, '10'], [1234.56, 10, '1'], [100, 5, '0.01'], [0.5, -90, '1']] as const)
      expect(redondear(new D(p).times(new D(1).plus(new D(pct).div(100))), r).toString()).toBe(aumentar(new D(p), pct, r).toString());
  });
});
