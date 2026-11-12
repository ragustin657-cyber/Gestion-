import { Prisma } from '@prisma/client';
import { aumentar } from './aumento';

const D = Prisma.Decimal;
describe('aumentar', () => {
  it('redondea al múltiplo más cercano', () => {
    expect(aumentar(new D(2500), 7.3, '10').toString()).toBe('2680');
    expect(aumentar(new D(1234.56), 10, '1').toString()).toBe('1358');
    expect(aumentar(new D(100), 5, '0.01').toString()).toBe('105');
  });
  it('nunca deja el precio en cero', () => {
    expect(aumentar(new D(0.5), -90, '1').toString()).toBe('1');
  });
});
