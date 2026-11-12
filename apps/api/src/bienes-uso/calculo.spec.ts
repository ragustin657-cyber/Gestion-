import { Prisma } from '@prisma/client';
import { acumuladaEsperada, DatosBien, mesesEntre, sumarMeses, ultimoMesAmortizable } from './calculo';

const D = (n: number) => new Prisma.Decimal(n);
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const bien = (o: Partial<DatosBien>): DatosBien => ({
  fechaAlta: f('2026-03-15'), valorOrigen: D(1200000), valorResidual: D(0), vidaUtilMeses: 60,
  amortizacionInicial: D(0), fechaAmortizacionInicial: null, fechaBaja: null, ...o,
});

describe('cálculo de amortización', () => {
  it('rodado del ejemplo', () => {
    const b = bien({});
    expect(acumuladaEsperada(b, '2026-09').toFixed(2)).toBe('140000.00');
    expect(acumuladaEsperada(b, '2026-02').toFixed(2)).toBe('0.00');
    expect(acumuladaEsperada(b, '2026-03').toFixed(2)).toBe('20000.00');
  });

  it('redondeo del último mes', () => {
    const b = bien({ fechaAlta: f('2026-01-10'), valorOrigen: D(1000), vidaUtilMeses: 3 });
    expect(['2026-01', '2026-02', '2026-03', '2026-04'].map((m) => acumuladaEsperada(b, m).toFixed(2))).toEqual(['333.33', '666.67', '1000.00', '1000.00']);
  });

  it('valor residual', () => {
    const b = bien({ fechaAlta: f('2026-01-10'), valorOrigen: D(1000), valorResidual: D(100), vidaUtilMeses: 9 });
    expect(acumuladaEsperada(b, '2026-09').toFixed(2)).toBe('900.00');
  });

  it('baja: no amortiza el mes de baja', () => {
    const b = bien({ fechaBaja: f('2026-10-15') });
    expect(acumuladaEsperada(b, '2026-12').toFixed(2)).toBe('140000.00');
    expect(ultimoMesAmortizable(b)).toBe('2026-09');
    expect(ultimoMesAmortizable(bien({}))).toBe('2031-02');
  });

  it('carga inicial', () => {
    const b = bien({ fechaAlta: f('2025-01-01'), valorOrigen: D(1200), vidaUtilMeses: 12, amortizacionInicial: D(600), fechaAmortizacionInicial: f('2025-06-30') });
    expect(acumuladaEsperada(b, '2025-06').toFixed(2)).toBe('600.00');
    expect(acumuladaEsperada(b, '2025-07').toFixed(2)).toBe('700.00');
    expect(acumuladaEsperada(b, '2025-12').toFixed(2)).toBe('1200.00');
    expect(acumuladaEsperada(b, '2026-03').toFixed(2)).toBe('1200.00');
  });

  it('meses', () => {
    expect(mesesEntre('2025-11', '2026-02')).toBe(4);
    expect(mesesEntre('2026-03', '2026-02')).toBe(0);
    expect(sumarMeses('2026-11', 3)).toBe('2027-02');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
  });
});
