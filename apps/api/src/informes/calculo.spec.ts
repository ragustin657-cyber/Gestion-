import { Prisma } from '@prisma/client';
import { anioAnterior, coeficientes, periodoAnterior, rotacion, tramoDe, variacion } from './calculo';

const D = Prisma.Decimal;
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (p: { desde: Date; hasta: Date }) => [p.desde.toISOString().slice(0, 10), p.hasta.toISOString().slice(0, 10)];

describe('cálculo de informes', () => {
  it('tramos de antigüedad en los bordes', () => {
    const corte = f('2026-11-30');
    const antes = (dias: number) => new Date(corte.getTime() - dias * 86400000);
    expect([0, 1, 30, 31, 60, 61, 90, 91].map((d) => tramoDe(corte, antes(d)))).toEqual(['aVencer', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'mas90']);
    expect(tramoDe(corte, f('2026-12-15'))).toBe('aVencer');
  });

  it('coeficientes de reexpresión', () => {
    const idx = new Map([['2026-10', new D(100)], ['2026-11', new D(110)]]);
    const r = coeficientes(['2026-10', '2026-11'], idx, '2026-11');
    expect('coef' in r && [r.base, r.coef.get('2026-10')!.toString(), r.coef.get('2026-11')!.toString()]).toEqual(['2026-11', '1.1', '1']);
    expect(coeficientes(['2026-10', '2026-11'], new Map([['2026-11', new D(110)]]), '2026-11')).toEqual({ faltan: ['10/2026'] });
    const dic = coeficientes(['2026-10'], idx, '2026-12');
    expect('base' in dic && dic.base).toBe('2026-11');
  });

  it('rotación y días de cobertura', () => {
    expect(rotacion(new D(330), new D(0), new D(670), 30)).toEqual({ rotacion: '0.99', diasCobertura: '60.9' });
    expect(rotacion(new D(0), new D(10), new D(10), 30).diasCobertura).toBeNull();
    expect(rotacion(new D(5), new D(0), new D(0), 30).rotacion).toBeNull();
  });

  it('variación', () => {
    expect(variacion(new D(110), new D(100))).toEqual({ importe: '10.00', pct: '10.00' });
    expect(variacion(new D(5), new D(0)).pct).toBeNull();
  });

  it('períodos de comparación', () => {
    expect(iso(periodoAnterior(f('2026-11-01'), f('2026-11-30')))).toEqual(['2026-10-02', '2026-10-31']);
    expect(iso(periodoAnterior(f('2026-01-01'), f('2026-01-01')))).toEqual(['2025-12-31', '2025-12-31']);
    expect(iso(anioAnterior(f('2026-02-01'), f('2026-02-28')))).toEqual(['2025-02-01', '2025-02-28']);
  });
});
