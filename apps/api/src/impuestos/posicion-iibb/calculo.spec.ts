import { Prisma } from '@prisma/client';
import { calcularPosicionIibb, renglonesAsientoIibb } from './calculo';

const cuadra = (rs: { debe: string; haber: string }[]) => {
  const d = rs.reduce((t, r) => t.plus(r.debe), new Prisma.Decimal(0));
  const h = rs.reduce((t, r) => t.plus(r.haber), new Prisma.Decimal(0));
  expect(d.toFixed(2)).toBe(h.toFixed(2));
  expect(rs.every((r) => r.debe !== '0.00' || r.haber !== '0.00')).toBe(true);
};
const j = (jurisdiccion: string, coeficiente: string, alicuota: string, o: Partial<{ retenciones: string; percepciones: string; saldoAnterior: string }> = {}) =>
  ({ jurisdiccion, coeficiente, alicuota, retenciones: '0', percepciones: '0', saldoAnterior: '0', ...o });

describe('liquidación de IIBB CM: cálculo (E38)', () => {
  it('base e impuesto por jurisdicción; la retención baja lo a pagar', () => {
    const p = calcularPosicionIibb({ ingresos: '1000000', jurisdicciones: [j('902', '0.6', '3.5', { retenciones: '5000' }), j('901', '0.4', '2')] });
    expect(p.ingresos).toBe('1000000.00');
    expect(p.detalle.map((d) => [d.jurisdiccion, d.base, d.impuesto, d.aPagar, d.saldoAFavor])).toEqual([
      ['902', '600000.00', '21000.00', '16000.00', '0.00'], ['901', '400000.00', '8000.00', '8000.00', '0.00']]);
    expect(p.totales).toMatchObject({ base: '1000000.00', impuesto: '29000.00', retenciones: '5000.00', aPagar: '24000.00', saldoAFavor: '0.00' });
    cuadra(renglonesAsientoIibb(p));
  });

  it('créditos mayores al impuesto dan saldo a favor y no se compensan con otra jurisdicción', () => {
    const p = calcularPosicionIibb({ ingresos: '100000', jurisdicciones: [j('902', '0.5', '3', { percepciones: '1000', saldoAnterior: '2000' }), j('904', '0.5', '4')] });
    expect(p.detalle.map((d) => [d.impuesto, d.aPagar, d.saldoAFavor])).toEqual([['1500.00', '0.00', '1500.00'], ['2000.00', '2000.00', '0.00']]);
    const rs = renglonesAsientoIibb(p);
    cuadra(rs);
    expect(rs).toEqual(expect.arrayContaining([
      { concepto: 'IIBB_IMPUESTO', debe: '3500.00', haber: '0.00' }, { concepto: 'PERCEPCION_IIBB', debe: '0.00', haber: '1000.00' },
      { concepto: 'IIBB_SALDO_A_FAVOR', debe: '0.00', haber: '500.00' }, { concepto: 'IIBB_A_PAGAR', debe: '0.00', haber: '2000.00' }]));
  });

  it('ingresos negativos: el impuesto negativo es saldo a favor y va al Haber del gasto', () => {
    const p = calcularPosicionIibb({ ingresos: '-10000', jurisdicciones: [j('901', '1', '3', { retenciones: '100' })] });
    expect(p.detalle[0]).toMatchObject({ base: '-10000.00', impuesto: '-300.00', aPagar: '0.00', saldoAFavor: '400.00' });
    const rs = renglonesAsientoIibb(p);
    cuadra(rs);
    expect(rs).toContainEqual({ concepto: 'IIBB_IMPUESTO', debe: '0.00', haber: '300.00' });
  });

  it('coeficiente 0 con retenciones: todo a saldo a favor', () => {
    const p = calcularPosicionIibb({ ingresos: '50000', jurisdicciones: [j('901', '1', '3'), j('913', '0', '2', { retenciones: '1000' })] });
    expect(p.detalle[1]).toMatchObject({ base: '0.00', impuesto: '0.00', saldoAFavor: '1000.00' });
    cuadra(renglonesAsientoIibb(p));
  });

  it('mes sin movimientos con saldo anterior: arrastra y no genera renglones', () => {
    const p = calcularPosicionIibb({ ingresos: '0', jurisdicciones: [j('901', '1', '3', { saldoAnterior: '700' })] });
    expect(p.detalle[0].saldoAFavor).toBe('700.00');
    expect(renglonesAsientoIibb(p)).toEqual([]);
  });

  it('redondea base e impuesto por jurisdicción', () => {
    const p = calcularPosicionIibb({ ingresos: '333.33', jurisdicciones: [j('901', '0.333333', '3.5')] });
    expect(p.detalle[0]).toMatchObject({ base: '111.11', impuesto: '3.89' });
  });
});
