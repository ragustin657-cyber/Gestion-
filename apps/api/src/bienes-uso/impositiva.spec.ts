import { Prisma } from '@prisma/client';
import { amortizacionImpositiva, BienImpositivo, ContextoImpositivo, EjercicioFiscal, ejerciciosFiscales, mesesQueActualiza } from './impositiva';

const D = Prisma.Decimal;
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const ej = (anio: number): EjercicioFiscal => ({ desde: f(`${anio}-01-01`), hasta: f(`${anio}-12-31`) });
const CAL = [ej(2024), ej(2025), ej(2026), ej(2027)];
const ctx = (indices: Record<string, number>, o: Partial<ContextoImpositivo> = {}): ContextoImpositivo => ({
  ejercicios: CAL, topeAutomoviles: new D(20000000),
  indice: (m) => { if (indices[m] === undefined) throw new Error(`sin índice ${m}`); return new D(indices[m]); },
  ...o,
});
const bien = (o: Partial<BienImpositivo>): BienImpositivo => ({ fechaAlta: f('2024-07-10'), fechaBaja: null, valorOrigen: new D(10000), valorTerreno: new D(0), tipo: 'MUEBLE', vidaUtilAnios: 5, ...o });
const n = (r: Record<string, unknown>, ...k: string[]) => k.map((x) => (r[x] instanceof D ? Number(r[x]) : r[x]));

describe('amortización impositiva (E44)', () => {
  it('mueble actualizado: año de alta completo', () => {
    const r = amortizacionImpositiva(bien({}), ej(2026), ctx({ '2024-07': 100, '2026-12': 200 }));
    expect(n(r as never, 'actualiza', 'coeficiente', 'valorActualizado', 'aniosAnteriores', 'acumuladaAnterior', 'cuota', 'acumuladaCierre', 'valorResidual', 'costoComputableBaja'))
      .toEqual([true, 2, 20000, 2, 8000, 4000, 12000, 8000, null]);
  });

  it('bien anterior a 2018: sin actualización; terminada la vida, cuota 0', () => {
    const b = bien({ fechaAlta: f('2017-05-02'), valorOrigen: new D(5000), vidaUtilAnios: 10 });
    const ejs = ejerciciosFiscales(CAL, b.fechaAlta);
    const r = amortizacionImpositiva(b, ej(2026), ctx({}, { ejercicios: ejs }));
    expect(n(r as never, 'actualiza', 'coeficiente', 'aniosAnteriores', 'cuota', 'acumuladaCierre', 'valorResidual')).toEqual([false, 1, 9, 500, 5000, 0]);
    expect(Number(amortizacionImpositiva(b, ej(2027), ctx({}, { ejercicios: ejs })).cuota)).toBe(0);
  });

  it('inmueble: sin terreno y por trimestres el año del alta', () => {
    const r = amortizacionImpositiva(bien({ tipo: 'INMUEBLE', fechaAlta: f('2026-05-15'), valorOrigen: new D(1000000), valorTerreno: new D(200000), vidaUtilAnios: 50 }), ej(2026), ctx({ '2026-05': 180, '2026-12': 200 }));
    expect(n(r as never, 'valorActualizado', 'cuota', 'acumuladaAnterior')).toEqual([1111111.11, 13333.33, 0]);
  });

  it('inmueble: el año siguiente cuenta la fracción del primero', () => {
    const r = amortizacionImpositiva(bien({ tipo: 'INMUEBLE', fechaAlta: f('2025-05-15'), valorOrigen: new D(1000000), valorTerreno: new D(0), vidaUtilAnios: 50 }), ej(2026), ctx({ '2025-05': 100, '2026-12': 100 }));
    expect(n(r as never, 'aniosAnteriores', 'acumuladaAnterior', 'cuota')).toEqual([0.75, 15000, 20000]);
  });

  it('automóvil: la parte sobre el tope no es deducible', () => {
    const r = amortizacionImpositiva(bien({ tipo: 'AUTOMOVIL', fechaAlta: f('2026-12-01'), valorOrigen: new D(40000000) }), ej(2026), ctx({ '2026-12': 100 }));
    expect(n(r as never, 'cuota', 'noDeducible', 'valorResidual')).toEqual([8000000, 4000000, 32000000]);
  });

  it('baja en el ejercicio: sin cuota y costo computable al mes de la baja', () => {
    const r = amortizacionImpositiva(bien({ fechaBaja: f('2026-03-15') }), ej(2026), ctx({ '2024-07': 100, '2026-03': 150 }));
    expect(n(r as never, 'coeficiente', 'cuota', 'costoComputableBaja')).toEqual([1.5, 0, 9000]);
  });

  it('último año de vida: el remanente', () => {
    const r = amortizacionImpositiva(bien({ fechaAlta: f('2022-01-10'), valorOrigen: new D(1000), vidaUtilAnios: 3 }), ej(2024), ctx({ '2022-01': 100, '2024-12': 100 }, { ejercicios: ejerciciosFiscales(CAL, f('2022-01-10')) }));
    expect(n(r as never, 'cuota', 'acumuladaCierre', 'valorResidual')).toEqual([333.34, 1000, 0]);
  });

  it('no amortizable: sin cuota, residual actualizado', () => {
    const r = amortizacionImpositiva(bien({ tipo: 'NO_AMORTIZABLE', fechaAlta: f('2025-02-01'), valorOrigen: new D(500000) }), ej(2026), ctx({ '2025-02': 100, '2026-12': 150 }));
    expect(n(r as never, 'cuota', 'valorResidual')).toEqual([0, 750000]);
  });

  it('ejercicios supuestos antes del primero del sistema (no calendario)', () => {
    const sis = [{ desde: f('2025-07-01'), hasta: f('2026-06-30') }];
    const ejs = ejerciciosFiscales(sis, f('2023-10-01'));
    expect(ejs.map((e) => [e.desde.toISOString().slice(0, 10), e.hasta.toISOString().slice(0, 10)])).toEqual([
      ['2023-07-01', '2024-06-30'], ['2024-07-01', '2025-06-30'], ['2025-07-01', '2026-06-30'],
    ]);
    const r = amortizacionImpositiva(bien({ fechaAlta: f('2023-10-05') }), sis[0], ctx({ '2023-10': 100, '2026-06': 100 }, { ejercicios: ejs }));
    expect(r.aniosAnteriores).toBe(2);
  });

  it('corte 2018: se mira el inicio del ejercicio del alta', () => {
    const sis = [{ desde: f('2025-07-01'), hasta: f('2026-06-30') }];
    const ejs = ejerciciosFiscales(sis, f('2018-03-10'));
    expect(mesesQueActualiza(bien({ fechaAlta: f('2018-03-10') }), sis[0], ejs)).toEqual([]);
    expect(mesesQueActualiza(bien({ fechaAlta: f('2018-08-01') }), sis[0], ejs)).toEqual(['2018-08', '2026-06']);
    expect(mesesQueActualiza(bien({}), ej(2026), CAL)).toEqual(['2024-07', '2026-12']);
    expect(mesesQueActualiza(bien({ fechaAlta: f('2017-05-02') }), ej(2026), ejerciciosFiscales(CAL, f('2017-05-02')))).toEqual([]);
  });
});
