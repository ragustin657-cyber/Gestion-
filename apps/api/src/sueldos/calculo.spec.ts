import { Prisma } from '@prisma/client';
import { antiguedadAnios, ConceptoCalc, diasTrabajados, EmpleadoCalc, liquidarMes, liquidarSac } from './calculo';

const D = (n: number) => new Prisma.Decimal(n);
const f = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const c = (codigo: string, nombre: string, clase: ConceptoCalc['clase'], tipo: ConceptoCalc['tipo'], parametros: Record<string, unknown> = {}, soloAfiliados = false): ConceptoCalc =>
  ({ id: `c${codigo}`, codigo, nombre, clase, tipo, parametros, orden: Number(codigo) + ++n * 0, soloAfiliados });

/** Conceptos precargados de Comercio (spec §4). */
export const COMERCIO: ConceptoCalc[] = [
  c('100', 'Sueldo básico', 'REMUNERATIVO', 'BASICO'),
  c('110', 'Antigüedad', 'REMUNERATIVO', 'ANTIGUEDAD', { pctPorAnio: 1 }),
  c('120', 'Presentismo', 'REMUNERATIVO', 'PORCENTAJE', { pct: 8.33, base: 'BASICO_MAS_ANTIGUEDAD', pierdeConAusencia: true }),
  c('130', 'Horas extra 50 %', 'REMUNERATIVO', 'HORAS_EXTRA', { recargoPct: 50 }),
  c('131', 'Horas extra 100 %', 'REMUNERATIVO', 'HORAS_EXTRA', { recargoPct: 100 }),
  c('140', 'Ausencias injustificadas', 'REMUNERATIVO', 'AUSENCIA'),
  c('500', 'Jubilación', 'DESCUENTO', 'DESCUENTO_LEY', { pct: 11, base: 'REMUNERATIVO' }),
  c('510', 'Ley 19.032', 'DESCUENTO', 'DESCUENTO_LEY', { pct: 3, base: 'REMUNERATIVO' }),
  c('520', 'Obra social', 'DESCUENTO', 'DESCUENTO_LEY', { pct: 3, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }),
  c('530', 'FAECYS', 'DESCUENTO', 'DESCUENTO_LEY', { pct: 0.5, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }),
  c('540', 'Sindicato', 'DESCUENTO', 'DESCUENTO_LEY', { pct: 2, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }, true),
];
const empleado = (o: Partial<EmpleadoCalc> = {}): EmpleadoCalc => ({ fechaIngreso: f('2021-03-01'), fechaEgreso: null, afiliadoSindicato: true, basicoMensual: D(1000000), horasMensuales: 200, ...o });
const mapa = (r: ReturnType<typeof liquidarMes>) => Object.fromEntries(r.renglones.map((x) => [x.codigo, x.importe.toFixed(2)]));

describe('cálculo de sueldos', () => {
  it('ejemplo del spec', () => {
    const r = liquidarMes(empleado(), COMERCIO, [{ tipo: 'HORAS_EXTRA_50', cantidad: D(4) }], 2026, 11);
    expect(mapa(r)).toEqual({ '100': '1000000.00', '110': '50000.00', '120': '87465.00', '130': '31500.00', '500': '128586.15', '510': '35068.95', '520': '35068.95', '530': '5844.83', '540': '23379.30' });
    expect([r.totalRemunerativo.toFixed(2), r.totalDescuentos.toFixed(2), r.neto.toFixed(2)]).toEqual(['1168965.00', '227948.18', '941016.82']);
    expect([r.diasTrabajados, r.antiguedadAnios]).toEqual([30, 5]);
  });

  it('ausencia injustificada', () => {
    const r = liquidarMes(empleado(), COMERCIO, [{ tipo: 'HORAS_EXTRA_50', cantidad: D(4) }, { tipo: 'AUSENCIA_INJUSTIFICADA', cantidad: D(1) }], 2026, 11);
    expect(mapa(r)['140']).toBe('-35000.00');
    expect(mapa(r)['120']).toBeUndefined();
    expect(r.totalRemunerativo.toFixed(2)).toBe('1046500.00');
  });

  it('no afiliado', () => {
    expect(mapa(liquidarMes(empleado({ afiliadoSindicato: false }), COMERCIO, [], 2026, 11))['540']).toBeUndefined();
  });

  it('ingreso a mitad de mes', () => {
    const r = liquidarMes(empleado({ fechaIngreso: f('2026-11-16') }), COMERCIO, [{ tipo: 'HORAS_EXTRA_50', cantidad: D(2) }], 2026, 11);
    expect(r.diasTrabajados).toBe(15);
    const m = mapa(r);
    expect([m['100'], m['110'], m['120'], m['130']]).toEqual(['500000.00', undefined, '41650.00', '15000.00']);
  });

  it('antigüedad en el aniversario', () => {
    expect(antiguedadAnios(f('2021-11-30'), f('2026-11-30'))).toBe(5);
    expect(antiguedadAnios(f('2021-12-01'), f('2026-11-30'))).toBe(4);
    expect(diasTrabajados(f('2020-01-01'), f('2026-11-10'), 2026, 11)).toBe(10);
    expect(diasTrabajados(f('2026-02-01'), null, 2026, 2)).toBe(30);
  });

  it('base remunerativo + no remunerativo', () => {
    const conceptos = [...COMERCIO, c('300', 'Suma no remunerativa', 'NO_REMUNERATIVO', 'FIJO', { importe: 100000 })];
    const m = mapa(liquidarMes(empleado(), conceptos, [], 2026, 11));
    // remunerativo 1.137.465: jubilación sin cambio; obra social sobre 1.237.465
    expect([m['300'], m['500'], m['520']]).toEqual(['100000.00', '125121.15', '37123.95']);
  });

  it('SAC', () => {
    expect(liquidarSac(empleado(), COMERCIO, D(1168965), 2026, 2).renglones[0]).toMatchObject({ codigo: '200' });
    expect(liquidarSac(empleado(), COMERCIO, D(1168965), 2026, 2).renglones[0].importe.toFixed(2)).toBe('584482.50');
    expect(liquidarSac(empleado({ fechaIngreso: f('2026-10-01') }), COMERCIO, D(1168965), 2026, 2).renglones[0].importe.toFixed(2)).toBe('292241.25');
  });
});
