import { Prisma } from '@prisma/client';
import { DatosDj, determinarDj, impuestoEscala, TramoEscala } from './calculo';

const D = Prisma.Decimal;
const LEY: TramoEscala[] = [
  { desde: new D(0), fijo: new D(0), alicuota: new D(25) },
  { desde: new D(5000000), fijo: new D(1250000), alicuota: new D(30) },
  { desde: new D(50000000), fijo: new D(14750000), alicuota: new D(35) },
];
const cero = new D(0);
const datos = (o: Partial<DatosDj> = {}): DatosDj => ({
  resultadoContable: new D(10000000), diferenciaAmortizaciones: new D(200000), ajusteInflacion: new D(-1500000),
  ajustesManuales: [{ concepto: 'Gastos no deducibles', importe: new D(300000) }, { concepto: 'Ingresos exentos', importe: new D(-100000) }],
  quebrantosAnteriores: new D(500000), tramos: LEY,
  retenciones: new D(100000), percepciones: new D(50000), impuestoCheque: new D(150000), anticiposIngresados: new D(600000), saldoAFavorAnterior: new D(20000), otrosPagos: new D(30000),
  mesCierre: '2026-12', mesesEjercicio: 12, ...o,
});
const n = (x: Prisma.Decimal) => Number(x);

describe('DJ de Ganancias de sociedades (E46)', () => {
  it('del resultado contable al impuesto y el saldo', () => {
    const r = determinarDj(datos());
    expect([r.ajusteAmortizaciones, r.ajusteInflacion, r.totalAjustesManuales, r.resultadoImpositivo, r.quebrantosComputados, r.gananciaNetaImponible, r.impuestoDeterminado, r.pagosACuenta, r.saldo].map(n))
      .toEqual([-200000, -1500000, 200000, 8500000, 500000, 8000000, 2150000, 950000, 1200000]);
    expect(r.avisos).toEqual([]);
  });

  it('anticipos: 25 % y nueve de 8,33 %, el último ajusta; meses desde el sexto posterior al cierre', () => {
    const r = determinarDj(datos());
    expect([n(r.baseAnticipos), r.vencimientoDj]).toEqual([1850000, '2027-05']);
    expect(r.anticipos.map((a) => [a.numero, a.mes, n(a.importe)])).toEqual([
      [1, '2027-06', 462500], ...[2, 3, 4, 5, 6, 7, 8, 9].map((k, i) => [k, `${i < 6 ? 2027 : 2028}-${String(((6 + i) % 12) + 1).padStart(2, '0')}`, 154105]), [10, '2028-03', 154660],
    ]);
    expect(r.anticipos.reduce((s, a) => s + n(a.importe), 0)).toBeCloseTo(1850000, 2);
  });

  it('quebranto del ejercicio: impuesto y anticipos en cero', () => {
    const r = determinarDj(datos({ resultadoContable: new D(1200000) }));
    expect([n(r.resultadoImpositivo), n(r.quebrantosComputados), n(r.quebrantoEjercicio), n(r.gananciaNetaImponible), n(r.impuestoDeterminado), n(r.baseAnticipos)]).toEqual([-300000, 0, 300000, 0, 0, 0]);
    expect(r.anticipos.every((a) => a.importe.isZero())).toBe(true);
  });

  it('quebrantos anteriores mayores que el resultado: se computan hasta el resultado', () => {
    const r = determinarDj(datos({ resultadoContable: new D(1900000) }));
    expect([n(r.resultadoImpositivo), n(r.quebrantosComputados), n(r.gananciaNetaImponible)]).toEqual([400000, 400000, 0]);
  });

  it('escala por tramos', () => {
    expect([impuestoEscala(new D(60000000), LEY), impuestoEscala(new D(5000000), LEY), impuestoEscala(new D(1000000), LEY)].map(n)).toEqual([18250000, 1250000, 250000]);
  });

  it('ejercicio irregular: aviso; sin impuesto con retenciones: saldo a favor', () => {
    expect(determinarDj(datos({ mesesEjercicio: 6 })).avisos).toContain('El ejercicio no es de 12 meses: verifique la escala aplicada');
    const r = determinarDj(datos({ resultadoContable: cero, diferenciaAmortizaciones: cero, ajusteInflacion: cero, ajustesManuales: [], quebrantosAnteriores: cero, percepciones: cero, impuestoCheque: cero, anticiposIngresados: cero, saldoAFavorAnterior: cero, otrosPagos: cero }));
    expect([n(r.impuestoDeterminado), n(r.saldo)]).toEqual([0, -100000]);
  });
});
