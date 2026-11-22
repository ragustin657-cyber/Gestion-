import { Prisma } from '@prisma/client';
import { calcularPosicionIva, renglonesAsiento } from './calculo';
import { filasPosicion } from './posicion-iva.controller';
import { ajusteAnual, coeficienteProrrateo, mesesDelEjercicio, separarCredito, ultimoMesEjercicio } from './prorrateo';

describe('prorrateo del crédito fiscal (E40)', () => {
  it('coeficiente', () => {
    expect(coeficienteProrrateo('70000', '30000')).toEqual({ coeficiente: '0.7000', sinVentas: false, acotado: null });
    expect(coeficienteProrrateo('0', '0')).toEqual({ coeficiente: '1.0000', sinVentas: true, acotado: null });
    expect(coeficienteProrrateo('-100', '300').coeficiente).toBe('0.0000');
    expect(coeficienteProrrateo('100', '-50').coeficiente).toBe('1.0000');
  });

  it('separar el crédito', () => {
    expect(separarCredito({ gravado: '1000', exento: '200', comun: '500', coeficiente: '0.7' })).toEqual({ computable: '1350.00', noComputable: '350.00' });
    expect(separarCredito({ gravado: '0', exento: '0', comun: '500', coeficiente: '0.7', ajuste: '-400' })).toEqual({ computable: '-50.00', noComputable: '550.00' });
    expect(separarCredito({ gravado: '0', exento: '0', comun: '100', coeficiente: '0.5', ajuste: '100' })).toEqual({ computable: '150.00', noComputable: '-50.00' });
  });

  it('ajuste anual', () => {
    const comunPorMes = [{ comun: '500', computado: '350' }, { comun: '500', computado: '250' }];
    expect(ajusteAnual({ comunPorMes, coeficienteAnual: '0.6' })).toBe('0.00');
    expect(ajusteAnual({ comunPorMes, coeficienteAnual: '0.4' })).toBe('-200.00');
  });

  it('meses del ejercicio fiscal', () => {
    expect(mesesDelEjercicio(2026, 8, 7)).toEqual([{ anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }]);
    expect(mesesDelEjercicio(2027, 6, 7)).toHaveLength(12);
    expect(mesesDelEjercicio(2027, 6, 7)[0]).toEqual({ anio: 2026, mes: 7 });
    expect(mesesDelEjercicio(2026, 3, 1)).toEqual([{ anio: 2026, mes: 1 }, { anio: 2026, mes: 2 }, { anio: 2026, mes: 3 }]);
    expect([ultimoMesEjercicio(6, 7), ultimoMesEjercicio(12, 1), ultimoMesEjercicio(11, 1)]).toEqual([true, true, false]);
  });

  it('asiento con no computable: al Debe; negativo al Haber; cuadra', () => {
    const base = { debito: { '21': '2100' }, credito: { '21': '525' }, retenciones: '0', percepciones: '0', saldoTecnicoAnterior: '0', libreAnterior: '0',
      totalDebito: '2100.00', totalCredito: '525.00', saldoTecnicoAFavor: '0.00', impuestoDeterminado: '1785.00', impuestoAPagar: '1785.00', libreDisponibilidad: '0.00' };
    const cuadra = (rs: { debe: string; haber: string }[]) => expect(rs.reduce((t, r) => t.plus(r.debe).minus(r.haber), new Prisma.Decimal(0)).toFixed(2)).toBe('0.00');
    // Crédito 525 con 210 no computable: determinado = 2100 − 315
    const conNc = { ...base, impuestoDeterminado: '1785.00', impuestoAPagar: '1785.00', creditoNoComputable: '210.00' };
    const rs = renglonesAsiento(conNc);
    expect(rs).toContainEqual({ concepto: 'IVA_NO_COMPUTABLE', debe: '210.00', haber: '0.00' });
    expect(rs).toContainEqual({ concepto: 'IVA_CREDITO_FISCAL', debe: '0.00', haber: '525.00' });
    cuadra(rs);
    const neg = renglonesAsiento({ ...base, impuestoDeterminado: '1525.00', impuestoAPagar: '1525.00', creditoNoComputable: '-50.00' });
    expect(neg).toContainEqual({ concepto: 'IVA_NO_COMPUTABLE', debe: '0.00', haber: '50.00' });
    cuadra(neg);
  });

  it('la posición usa el crédito computable cuando hay prorrateo', () => {
    const e = { debito: { '21': '2100' }, credito: { '21': '525' }, retenciones: '0', percepciones: '0', saldoTecnicoAnterior: '0', libreAnterior: '0' };
    expect(calcularPosicionIva(e).impuestoDeterminado).toBe('1575.00');
    const p = calcularPosicionIva({ ...e, creditoComputable: '315.00' });
    expect([p.totalCredito, p.impuestoDeterminado]).toEqual(['525.00', '1785.00']);
  });

  it('pulido E42: avisa cuando el coeficiente se acota por ventas negativas', () => {
    expect(coeficienteProrrateo('-300', '100')).toMatchObject({ coeficiente: '1.0000', acotado: 1 });
    expect(coeficienteProrrateo('-300', '500')).toMatchObject({ coeficiente: '0.0000', acotado: 0 });
    expect(coeficienteProrrateo('70000', '30000')).toMatchObject({ acotado: null });
  });

  it('pulido E42: en la exportación las filas del prorrateo siguen al total del crédito fiscal', () => {
    const p = { anio: 2026, mes: 10, estado: 'BORRADOR' as const, debito: { '21': '210.00' }, credito: { '21': '525.00' }, retenciones: '0.00', percepciones: '0.00',
      saldoTecnicoAnterior: '0.00', libreAnterior: '0.00', totalDebito: '210.00', totalCredito: '525.00', saldoTecnicoAFavor: '105.00', impuestoDeterminado: '0.00',
      impuestoAPagar: '0.00', libreDisponibilidad: '0.00', avisos: [], asientoId: null,
      coeficiente: '0.5000', creditoComun: '210.00', creditoComputable: '315.00', creditoNoComputable: '210.00', ajusteProrrateo: '0.00' };
    const conceptos = filasPosicion(p).map((f) => f[0]);
    expect(conceptos.indexOf('Coeficiente de prorrateo')).toBe(conceptos.indexOf('Total crédito fiscal') + 1);
  });
});
