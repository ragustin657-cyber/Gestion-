import { Prisma } from '@prisma/client';
import { linea, REG01, REG02, REG03, REG04, REG_CONCEPTO } from './lsd-diseno';

const largo = (c: { largo: number }[]) => c.reduce((s, x) => s + x.largo, 0);

describe('LSD: diseño de registro', () => {
  it('largos', () => {
    expect([REG01, REG02, REG03, REG04, REG_CONCEPTO].map(largo)).toEqual([35, 115, 51, 370, 195]);
  });

  it('registro 03', () => {
    expect(linea(REG03, { cuil: '20123456786', codigo: '100', cantidad: new Prisma.Decimal(12.5), unidad: 'D', importe: new Prisma.Decimal(1234.5), dc: 'C' }))
      .toBe('0320123456786100       01250D000000000123450C000000');
  });

  it('fuera de rango', () => {
    expect(() => linea(REG03, { cuil: '20123456786', codigo: '100', cantidad: null, unidad: '', importe: new Prisma.Decimal('10000000000000'), dc: 'C' })).toThrow('Importe: valor fuera de rango');
    expect(() => linea(REG03, { cuil: '20123456786', codigo: '100', cantidad: new Prisma.Decimal(1000), unidad: 'D', importe: new Prisma.Decimal(1), dc: 'C' })).toThrow('Cantidad: valor fuera de rango');
  });
});
