import { Prisma } from '@prisma/client';
import { calcularPosicionIva, renglonesAsiento } from './calculo';

const base = { debito: { '21': '21000' }, credito: { '21': '10000' }, retenciones: '1000', percepciones: '500', saldoTecnicoAnterior: '0', libreAnterior: '0' };
const cuadra = (rs: { debe: string; haber: string }[]) => {
  const d = rs.reduce((t, r) => t.plus(r.debe), new Prisma.Decimal(0));
  const h = rs.reduce((t, r) => t.plus(r.haber), new Prisma.Decimal(0));
  expect(d.toFixed(2)).toBe(h.toFixed(2));
};

describe('posición de IVA: cálculo (E37)', () => {
  it('impuesto a pagar', () => {
    const p = calcularPosicionIva(base);
    expect(p).toEqual({ totalDebito: '21000.00', totalCredito: '10000.00', saldoTecnicoAFavor: '0.00', impuestoDeterminado: '11000.00', impuestoAPagar: '9500.00', libreDisponibilidad: '0.00' });
    cuadra(renglonesAsiento({ ...base, ...p }));
  });

  it('saldo técnico a favor: retenciones y libre anterior pasan a libre disponibilidad', () => {
    const e = { ...base, debito: { '21': '5000' }, credito: { '21': '8000' }, percepciones: '0', libreAnterior: '200' };
    const p = calcularPosicionIva(e);
    expect([p.saldoTecnicoAFavor, p.impuestoDeterminado, p.impuestoAPagar, p.libreDisponibilidad]).toEqual(['3000.00', '0.00', '0.00', '1200.00']);
    cuadra(renglonesAsiento({ ...e, ...p }));
  });

  it('libre disponibilidad cuando las retenciones superan lo determinado', () => {
    const e = { ...base, debito: { '21': '2000' }, credito: { '21': '1000' }, retenciones: '1500', percepciones: '0' };
    const p = calcularPosicionIva(e);
    expect([p.impuestoDeterminado, p.impuestoAPagar, p.libreDisponibilidad]).toEqual(['1000.00', '0.00', '500.00']);
    cuadra(renglonesAsiento({ ...e, ...p }));
  });

  it('con saldo técnico anterior y varias alícuotas', () => {
    const e = { ...base, debito: { '21': '21000', '10.5': '1050' }, credito: { '21': '5000', '27': '2700' }, saldoTecnicoAnterior: '4000', libreAnterior: '300' };
    const p = calcularPosicionIva(e);
    // 22.050 − 7.700 − 4.000 = 10.350; − 1.000 − 500 − 300 = 8.550
    expect([p.totalDebito, p.totalCredito, p.impuestoDeterminado, p.impuestoAPagar]).toEqual(['22050.00', '7700.00', '10350.00', '8550.00']);
    cuadra(renglonesAsiento({ ...e, ...p }));
  });

  it('crédito negativo (notas de crédito de compra) va al Debe y el asiento cuadra', () => {
    const e = { ...base, credito: { '21': '-2000' } };
    const p = calcularPosicionIva(e);
    expect([p.totalCredito, p.impuestoDeterminado]).toEqual(['-2000.00', '23000.00']);
    const rs = renglonesAsiento({ ...e, ...p });
    expect(rs.find((r) => r.concepto === 'IVA_CREDITO_FISCAL')).toEqual({ concepto: 'IVA_CREDITO_FISCAL', debe: '2000.00', haber: '0.00' });
    cuadra(rs);
  });

  it('el asiento omite los renglones en cero', () => {
    const p = calcularPosicionIva(base);
    const rs = renglonesAsiento({ ...base, ...p });
    expect(rs.map((r) => r.concepto).sort()).toEqual(['IVA_A_PAGAR', 'IVA_CREDITO_FISCAL', 'IVA_DEBITO_FISCAL', 'PERCEPCION_IVA', 'RETENCION_SUFRIDA_IVA']);
  });

  it('mes sin movimientos con saldos anteriores: el asiento queda vacío (se netea por cuenta)', () => {
    const e = { debito: {}, credito: {}, retenciones: '0', percepciones: '0', saldoTecnicoAnterior: '500', libreAnterior: '100' };
    const p = calcularPosicionIva(e);
    expect([p.saldoTecnicoAFavor, p.libreDisponibilidad]).toEqual(['500.00', '100.00']);
    expect(renglonesAsiento({ ...e, ...p })).toEqual([]);
  });
});
