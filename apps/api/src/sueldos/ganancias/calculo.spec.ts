import { Prisma } from '@prisma/client';
import { DatosGanancias, retencionGanancias, TablaCalc } from './calculo';

const D = (x: number) => new Prisma.Decimal(x);
const TABLA: TablaCalc = {
  gni: D(1200000), deduccionEspecial: D(4800000), conyuge: D(1200000), hijo: D(600000), hijoIncapacitado: D(1200000),
  topeHipotecario: D(120000), topeSeguroMuerte: D(60000), topeSeguroMixto: D(60000), topeSeguroRetiro: D(60000), topeSepelio: D(12000),
  tramos: [{ desde: D(0), hasta: D(1200000), fijo: D(0), porcentaje: D(5) }, { desde: D(1200000), hasta: D(2400000), fijo: D(60000), porcentaje: D(10) }, { desde: D(2400000), hasta: null, fijo: D(180000), porcentaje: D(15) }],
};
const base = (o: Partial<DatosGanancias> = {}): DatosGanancias => ({
  mes: 1, tabla: TABLA, bruta: D(2000000), aportes: D(340000), deducciones: [], cargas: [], retenidoAnterior: D(0), retenidoEmpresa: D(0), brutaRecibo: D(2000000), ...o,
});

describe('Ganancias de cuarta: cálculo de la retención', () => {
  it('bajo el mínimo', () => {
    const r = retencionGanancias(base({ bruta: D(400000), aportes: D(68000), brutaRecibo: D(400000) }));
    expect([r.importe.toFixed(2), r.hoja.sujeta]).toEqual(['0.00', '0.00']);
  });

  it('ejemplo a mano', () => {
    const r = retencionGanancias(base());
    expect([r.hoja.gananciaNeta, r.hoja.personales.gni, r.hoja.sujeta, r.hoja.impuesto, r.importe.toFixed(2)]).toEqual(['1660000.00', '100000.00', '1160000.00', '159000.00', '159000.00']);
    expect(r.hoja.tramo).toEqual({ desde: '200000.00', fijo: '15000.00', porcentaje: '15.00' });
  });

  it('prorrateo por mes', () => {
    const r = retencionGanancias(base({ mes: 9, bruta: D(18000000), aportes: D(3060000), brutaRecibo: D(2000000) }));
    expect(r.hoja.impuesto).toBe('1431000.00');
    const s = retencionGanancias(base({ mes: 9, bruta: D(18000000), aportes: D(3060000), brutaRecibo: D(2000000), retenidoAnterior: D(1272000), retenidoEmpresa: D(1272000) }));
    expect(s.importe.toFixed(2)).toBe('159000.00');
  });

  it('cargas de familia', () => {
    const r = retencionGanancias(base({ cargas: [{ parentesco: 'CONYUGE', meses: 1, porcentaje: 100 }, { parentesco: 'HIJO', meses: 1, porcentaje: 50 }, { parentesco: 'OTRO', meses: 1, porcentaje: 100 }] }));
    expect(r.hoja.personales.cargas).toBe('125000.00');
    expect(r.hoja.sujeta).toBe('1035000.00');
  });

  it('topes de deducciones', () => {
    const r = retencionGanancias(base({ deducciones: [
      { tipo: 'CUOTAS_MEDICAS', importe: D(200000) }, { tipo: 'GASTOS_MEDICOS', importe: D(300000) }, { tipo: 'DONACIONES', importe: D(100000) },
      { tipo: 'ALQUILER', importe: D(3000000) }, { tipo: 'SERVICIO_DOMESTICO', importe: D(150000) }, { tipo: 'EDUCACION', importe: D(500000) },
      { tipo: 'INTERESES_HIPOTECARIOS', importe: D(50000) }, { tipo: 'OTRA', importe: D(10000) },
    ] }));
    const c = Object.fromEntries(r.hoja.deducciones.map((x) => [x.tipo, x.computado]));
    // Base del 5 %: 1.660.000 − (100.000 + 100.000 + 40.000 + 10.000) = 1.410.000 → 70.500; donaciones: 5 % de (1.410.000 − 70.500 − 70.500) = 63.450
    expect(c).toEqual({ CUOTAS_MEDICAS: '70500.00', GASTOS_MEDICOS: '70500.00', DONACIONES: '63450.00', ALQUILER: '100000.00', SERVICIO_DOMESTICO: '100000.00', EDUCACION: '40000.00', INTERESES_HIPOTECARIOS: '10000.00', OTRA: '0.00' });
    expect(r.hoja.avisos.some((a) => a.includes('no es deducible'))).toBe(true);
  });

  it('las deducciones sin tope porcentual bajan la base del 5 por ciento', () => {
    // Alquiler (100.000 computado) reduce la GN antes de los topes del 5 %: 1.660.000 − 100.000 = 1.560.000 → 5 % = 78.000
    const r = retencionGanancias(base({ deducciones: [{ tipo: 'ALQUILER', importe: D(3000000) }, { tipo: 'CUOTAS_MEDICAS', importe: D(200000) }] }));
    expect(r.hoja.deducciones.find((x) => x.tipo === 'CUOTAS_MEDICAS')!.computado).toBe('78000.00');
  });

  it('devolución', () => {
    const r = retencionGanancias(base({ bruta: D(1500000), aportes: D(255000), brutaRecibo: D(1500000), retenidoAnterior: D(150000), retenidoEmpresa: D(30000) }));
    expect(r.importe.toFixed(2)).toBe('-30000.00');
  });

  it('tope del 35 por ciento', () => {
    // Impuesto acumulado alto con un recibo chico: se retiene el 35 % y el resto queda para después
    const r = retencionGanancias(base({ mes: 2, bruta: D(4000000), aportes: D(340000), brutaRecibo: D(1000000) }));
    // GN 3.660.000 − personales 1.000.000 = 2.660.000; tramo 3 con límites ×2/12: 30.000 + 15 % × 2.260.000 = 369.000
    expect(r.hoja.calculado).toBe('369000.00');
    expect([r.importe.toFixed(2), r.hoja.noRetenido]).toEqual(['350000.00', '19000.00']);
  });

  it('revisión: la retención no deja el neto negativo', () => {
    // Otros descuentos dejan un neto de 100.000: aunque el 35 % permita más, se retiene como máximo el neto
    const r = retencionGanancias(base({ mes: 2, bruta: D(4000000), aportes: D(340000), brutaRecibo: D(1000000), netoRecibo: D(100000) }));
    expect([r.importe.toFixed(2), r.hoja.noRetenido]).toEqual(['100000.00', '269000.00']);
  });
});
