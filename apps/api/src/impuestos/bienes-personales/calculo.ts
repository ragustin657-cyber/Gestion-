import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Bienes Personales, acciones y participaciones: la sociedad como responsable sustituto (spec E47 §4). Cálculo puro. */
export type TipoTitular = 'PERSONA_HUMANA_PAIS' | 'PERSONA_HUMANA_EXTERIOR' | 'SUCESION_INDIVISA' | 'SOCIEDAD_EXTERIOR' | 'SOCIEDAD_PAIS';
export interface ParticipacionBp { socioId: string; nombre: string; documento: string; tipoTitular: TipoTitular; porcentaje: Dec }
export interface ResultadoBp {
  patrimonio: Dec; ajuste: Dec; base: Dec; alicuota: Dec; filas: (ParticipacionBp & { paga: boolean; vpp: Dec; impuesto: Dec })[];
  sumaParticipaciones: Dec; total: Dec; completo: boolean; avisos: string[];
}

/** Las personas jurídicas del país no pagan por sus acciones (no son sujetos del impuesto). */
const NO_PAGA: TipoTitular[] = ['SOCIEDAD_PAIS'];
const r2 = (x: Dec) => x.toDecimalPlaces(2);
/** Porcentaje con coma decimal y sin ceros sobrantes (90, 99,5). */
const pct = (x: Dec) => x.toDecimalPlaces(4).toString().replace('.', ',');

export function liquidarBienesPersonales(d: { patrimonio: Dec; ajuste: Dec; alicuota: Dec; participaciones: ParticipacionBp[] }): ResultadoBp {
  const base = new D(d.patrimonio).plus(d.ajuste);
  const filas = d.participaciones.map((p) => {
    const paga = !NO_PAGA.includes(p.tipoTitular);
    const vpp = r2(base.times(p.porcentaje).div(100));
    const impuesto = paga && vpp.gt(0) ? r2(vpp.times(d.alicuota).div(100)) : new D(0);
    return { ...p, porcentaje: new D(p.porcentaje), paga, vpp, impuesto };
  });
  const sumaParticipaciones = filas.reduce((s, f) => s.plus(f.porcentaje), new D(0));
  const total = filas.reduce((s, f) => s.plus(f.impuesto), new D(0));
  const completo = sumaParticipaciones.eq(100);
  const avisos: string[] = [];
  if (!completo) avisos.push(`Las participaciones suman ${pct(sumaParticipaciones)} %: deben sumar 100 %`);
  if (filas.length && !filas.some((f) => f.paga)) avisos.push('Ningún socio paga el impuesto como responsable sustituto');
  return { patrimonio: new D(d.patrimonio), ajuste: new D(d.ajuste), base, alicuota: new D(d.alicuota), filas, sumaParticipaciones, total, completo, avisos };
}
