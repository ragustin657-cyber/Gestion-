import { Prisma } from '@prisma/client';
import { antiguedadAnios, calcularContribuciones, ConceptoCalc, ContribucionCalc, diasTrabajados, EmpleadoCalc, liquidarMes, liquidarSac, validarConcepto } from './calculo';

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

  describe('contribuciones', () => {
    const k = (codigo: string, destino: ContribucionCalc['destino'], alicuota: number, importeFijo: number, aplicaDetraccion: boolean): ContribucionCalc =>
      ({ codigo, nombre: codigo, destino, alicuota: D(alicuota), importeFijo: D(importeFijo), aplicaDetraccion, cuentaContableId: 'cta' });
    const PRECARGA = [k('SIPA', 'SEGURIDAD_SOCIAL', 10.77, 0, true), k('PAMI', 'SEGURIDAD_SOCIAL', 1.59, 0, true), k('FNE', 'SEGURIDAD_SOCIAL', 0.94, 0, true), k('AAFF', 'SEGURIDAD_SOCIAL', 4.7, 0, true),
      k('OS', 'OBRA_SOCIAL', 6, 0, false), k('ART', 'ART', 2.5, 1500, false), k('SCVO', 'SEGURO_VIDA', 0, 1000, false)];
    const m = (r: ReturnType<typeof calcularContribuciones>) => Object.fromEntries(r.map((x) => [x.codigo, x.importe.toFixed(2)]));
    const det = new Prisma.Decimal('7003.68');

    it('contribuciones del ejemplo', () => {
      const r = calcularContribuciones(new Prisma.Decimal('1168965.00'), 30, 'MENSUAL', PRECARGA, det);
      expect(m(r)).toEqual({ SIPA: '125143.23', PAMI: '18475.18', FNE: '10922.44', AAFF: '54612.18', OS: '70137.90', ART: '30724.13', SCVO: '1000.00' });
      expect(r.reduce((s, x) => s.plus(x.importe), D(0)).toFixed(2)).toBe('311015.06');
      expect(r[0].base.toFixed(2)).toBe('1161961.32');
    });

    it('mes parcial y SAC', () => {
      const p = calcularContribuciones(new Prisma.Decimal('500000.00'), 15, 'MENSUAL', PRECARGA, det);
      expect(p[0].base.toFixed(2)).toBe('496498.16');
      expect(m(p).ART).toBe('14000.00');
      expect(m(p).SCVO).toBe('1000.00');
      const s = calcularContribuciones(new Prisma.Decimal('584482.50'), 184, 'SAC', PRECARGA, det);
      expect(s[0].base.toFixed(2)).toBe('580980.66');
      expect(m(s).SCVO).toBeUndefined();
      expect(m(s).ART).toBe('14612.06');
    });

    it('sin días y detracción mayor que la base', () => {
      expect(calcularContribuciones(new Prisma.Decimal('1000.00'), 0, 'MENSUAL', PRECARGA, det)).toEqual([]);
      const r = calcularContribuciones(new Prisma.Decimal('5000.00'), 30, 'MENSUAL', PRECARGA, det);
      expect(m(r).SIPA).toBeUndefined();
      expect(m(r).OS).toBe('300.00');
      expect(r.every((x) => x.base.gte(0))).toBe(true);
    });

    it('tope BASE_MAXIMA', () => {
      const conTope = COMERCIO.map((x) => (x.codigo === '500' ? { ...x, parametros: { pct: 11, tope: 'BASE_MAXIMA' } } : x));
      const r = liquidarMes(empleado(), conTope, [{ tipo: 'HORAS_EXTRA_50', cantidad: D(4) }], 2026, 11, D(1000000));
      expect(mapa(r)['500']).toBe('110000.00');
      expect(mapa(liquidarMes(empleado(), conTope, [{ tipo: 'HORAS_EXTRA_50', cantidad: D(4) }], 2026, 11, null))['500']).toBe('128586.15');
      const s = liquidarSac(empleado(), conTope, D(1168965), 2026, 2, D(1000000));
      expect(s.renglones.find((x) => x.codigo === '500')!.importe.toFixed(2)).toBe('55000.00');
      expect(validarConcepto('DESCUENTO_LEY', 'DESCUENTO', { pct: 11, tope: 'BASE_MAXIMA' })).toBeNull();
      expect(validarConcepto('DESCUENTO_LEY', 'DESCUENTO', { pct: 11, tope: 'OTRO' })).toBe('Parámetro tope inválido');
    });
  });
});
