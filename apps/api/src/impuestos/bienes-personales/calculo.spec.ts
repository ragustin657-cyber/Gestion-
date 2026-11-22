import { Prisma } from '@prisma/client';
import { liquidarBienesPersonales, ParticipacionBp, TipoTitular } from './calculo';

const D = Prisma.Decimal;
const p = (socioId: string, tipoTitular: TipoTitular, porcentaje: number | string): ParticipacionBp => ({ socioId, nombre: socioId, documento: '', tipoTitular, porcentaje: new D(porcentaje) });
const n = (x: Prisma.Decimal) => Number(x);
const base = { patrimonio: new D(10000000), ajuste: new D(-1000000), alicuota: new D('0.5') };

describe('Bienes Personales acciones y participaciones (E47)', () => {
  it('VPP e impuesto por socio; la sociedad del país no paga', () => {
    const r = liquidarBienesPersonales({ ...base, participaciones: [p('A', 'PERSONA_HUMANA_PAIS', 60), p('B', 'SOCIEDAD_PAIS', 30), p('C', 'PERSONA_HUMANA_EXTERIOR', 10)] });
    expect(n(r.base)).toBe(9000000);
    expect(r.filas.map((f) => [f.socioId, f.paga, n(f.vpp), n(f.impuesto)])).toEqual([['A', true, 5400000, 27000], ['B', false, 2700000, 0], ['C', true, 900000, 4500]]);
    expect([n(r.total), r.completo, r.avisos]).toEqual([31500, true, []]);
  });

  it('participaciones que no suman 100 %', () => {
    const r = liquidarBienesPersonales({ ...base, participaciones: [p('A', 'PERSONA_HUMANA_PAIS', 60), p('B', 'SOCIEDAD_PAIS', 30)] });
    expect([r.completo, r.avisos]).toEqual([false, ['Las participaciones suman 90 %: deben sumar 100 %']]);
    expect(liquidarBienesPersonales({ ...base, participaciones: [p('A', 'PERSONA_HUMANA_PAIS', '99.5')] }).avisos).toEqual(['Las participaciones suman 99,5 %: deben sumar 100 %']);
  });

  it('ningún socio paga', () => {
    const r = liquidarBienesPersonales({ ...base, participaciones: [p('B', 'SOCIEDAD_PAIS', 100)] });
    expect([n(r.total), r.avisos]).toEqual([0, ['Ningún socio paga el impuesto como responsable sustituto']]);
  });

  it('patrimonio negativo: impuesto 0', () => {
    const r = liquidarBienesPersonales({ patrimonio: new D(-500000), ajuste: new D(0), alicuota: new D('0.5'), participaciones: [p('A', 'PERSONA_HUMANA_PAIS', 100)] });
    expect([n(r.filas[0].vpp), n(r.filas[0].impuesto), n(r.total)]).toEqual([-500000, 0, 0]);
  });
});
