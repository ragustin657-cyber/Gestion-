import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const f = (x: Dec) => r2(x).toFixed(2);
const cero = () => new D(0);

export type TipoDeduccion =
  | 'CUOTAS_MEDICAS' | 'SEGURO_MUERTE' | 'SEGURO_MIXTO' | 'SEGURO_RETIRO' | 'DONACIONES' | 'INTERESES_HIPOTECARIOS' | 'SEPELIO' | 'GASTOS_MEDICOS'
  | 'INDUMENTARIA' | 'ALQUILER' | 'SERVICIO_DOMESTICO' | 'SGR' | 'VEHICULOS_CORREDORES' | 'INTERESES_CORREDORES' | 'EDUCACION' | 'CAJAS_JUBILACION' | 'OTRA';

export const NOMBRE_DEDUCCION: Record<TipoDeduccion, string> = {
  CUOTAS_MEDICAS: 'Cuotas médico-asistenciales', SEGURO_MUERTE: 'Primas de seguro para el caso de muerte', SEGURO_MIXTO: 'Primas de ahorro de seguros mixtos',
  SEGURO_RETIRO: 'Planes de seguro de retiro privados', DONACIONES: 'Donaciones', INTERESES_HIPOTECARIOS: 'Intereses de préstamo hipotecario', SEPELIO: 'Gastos de sepelio',
  GASTOS_MEDICOS: 'Gastos médicos y paramédicos', INDUMENTARIA: 'Indumentaria y equipamiento', ALQUILER: 'Alquiler de casa habitación', SERVICIO_DOMESTICO: 'Personal doméstico',
  SGR: 'Aporte a sociedades de garantía recíproca', VEHICULOS_CORREDORES: 'Vehículos de corredores y viajantes', INTERESES_CORREDORES: 'Intereses de corredores y viajantes',
  EDUCACION: 'Gastos de educación', CAJAS_JUBILACION: 'Aportes a cajas de jubilación', OTRA: 'Otra deducción',
};

export interface TablaCalc {
  gni: Dec; deduccionEspecial: Dec; conyuge: Dec; hijo: Dec; hijoIncapacitado: Dec;
  topeHipotecario: Dec; topeSeguroMuerte: Dec; topeSeguroMixto: Dec; topeSeguroRetiro: Dec; topeSepelio: Dec;
  tramos: { desde: Dec; hasta: Dec | null; fijo: Dec; porcentaje: Dec }[];
}

/** Datos acumulados a los meses 1..mes del año fiscal (spec E31 §5). La tabla llega ya acumulada (E32 §3). */
export interface DatosGanancias {
  mes: number;
  tabla: TablaCalc;
  bruta: Dec;
  aportes: Dec;
  deducciones: { tipo: TipoDeduccion; importe: Dec }[];
  /** Cargas de familia con su importe ya acumulado (E32 §3). */
  cargas: { parentesco: 'CONYUGE' | 'HIJO' | 'HIJO_INCAPACITADO' | 'OTRO'; importe: Dec }[];
  retenidoAnterior: Dec;
  /** Lo retenido en el año por esta empresa (límite de la devolución). */
  retenidoEmpresa: Dec;
  brutaRecibo: Dec;
  /** Neto del recibo antes de la retención: la retención no lo deja negativo (revisión E31). */
  netoRecibo?: Dec;
}

export interface HojaGanancias {
  mes: number; bruta: string; aportes: string; gananciaNeta: string;
  deducciones: { tipo: TipoDeduccion; nombre: string; informado: string; computado: string }[];
  personales: { gni: string; especial: string; cargas: string };
  sujeta: string; tramo: { desde: string; fijo: string; porcentaje: string }; impuesto: string;
  retenidoAnterior: string; calculado: string; topeMes: string; importe: string; noRetenido: string;
  avisos: string[];
}

const CON_TOPE_PORCENTUAL: TipoDeduccion[] = ['CUOTAS_MEDICAS', 'GASTOS_MEDICOS', 'DONACIONES'];

/**
 * Retención de Ganancias de cuarta del mes (RG 4003, spec E31 §5): acumulado del año, deducciones con sus topes prorrateados
 * por mes/12, escala prorrateada, menos lo retenido; devolución hasta lo retenido por la empresa y tope del 35 % del recibo.
 */
export function retencionGanancias(d: DatosGanancias): { importe: Dec; hoja: HojaGanancias } {
  const t = d.tabla;
  // La tabla llega acumulada al mes (o anual): no se prorratea acá (E32 §3)
  const p = (x: Dec) => x;
  const avisos: string[] = [];
  const informado = new Map<TipoDeduccion, Dec>();
  for (const x of d.deducciones) informado.set(x.tipo, (informado.get(x.tipo) ?? cero()).plus(x.importe));
  const computado = new Map<TipoDeduccion, Dec>();
  const limitar = (tipo: TipoDeduccion, valor: Dec, tope: Dec | null) => computado.set(tipo, r2(tope ? D.min(valor, tope) : valor));
  // Deducciones sin tope porcentual (§5.3)
  for (const [tipo, v] of informado) {
    switch (tipo) {
      case 'SEGURO_MUERTE': limitar(tipo, v, p(t.topeSeguroMuerte)); break;
      case 'SEGURO_MIXTO': limitar(tipo, v, p(t.topeSeguroMixto)); break;
      case 'SEGURO_RETIRO': limitar(tipo, v, p(t.topeSeguroRetiro)); break;
      case 'INTERESES_HIPOTECARIOS': limitar(tipo, v, p(t.topeHipotecario)); break;
      case 'SEPELIO': limitar(tipo, v, p(t.topeSepelio)); break;
      case 'ALQUILER': limitar(tipo, v.times(0.4), p(t.gni)); break;
      case 'SERVICIO_DOMESTICO': limitar(tipo, v, p(t.gni)); break;
      case 'EDUCACION': limitar(tipo, v.times(0.4), p(t.gni).times(0.4)); break;
      case 'INDUMENTARIA': case 'SGR': case 'VEHICULOS_CORREDORES': case 'INTERESES_CORREDORES': case 'CAJAS_JUBILACION': limitar(tipo, v, null); break;
      case 'OTRA': computado.set(tipo, cero()); avisos.push(`${NOMBRE_DEDUCCION.OTRA}: ${f(v)} informado que no es deducible en este régimen`); break;
      default: break;
    }
  }
  const sinPorcentual = [...computado.entries()].filter(([k]) => !CON_TOPE_PORCENTUAL.includes(k)).reduce((s, [, v]) => s.plus(v), cero());
  const gananciaNeta = d.bruta.minus(d.aportes).minus(sinPorcentual);
  // Topes del 5 % (RG 4003, Anexo II): cuotas médicas y gastos médicos sobre la misma GN; donaciones sobre la GN menos esas dos
  const base5 = D.max(gananciaNeta, 0).times(0.05);
  if (informado.has('CUOTAS_MEDICAS')) limitar('CUOTAS_MEDICAS', informado.get('CUOTAS_MEDICAS')!, base5);
  if (informado.has('GASTOS_MEDICOS')) limitar('GASTOS_MEDICOS', informado.get('GASTOS_MEDICOS')!.times(0.4), base5);
  if (informado.has('DONACIONES')) {
    const medicas = (computado.get('CUOTAS_MEDICAS') ?? cero()).plus(computado.get('GASTOS_MEDICOS') ?? cero());
    limitar('DONACIONES', informado.get('DONACIONES')!, D.max(gananciaNeta.minus(medicas), 0).times(0.05));
  }
  const conPorcentual = CON_TOPE_PORCENTUAL.reduce((s, k) => s.plus(computado.get(k) ?? 0), cero());
  // Deducciones personales (art. 30) prorrateadas
  const gni = r2(p(t.gni));
  const especial = r2(p(t.deduccionEspecial));
  const cargas = r2(d.cargas.reduce((s, c) => (c.parentesco === 'OTRO' ? s : s.plus(c.importe)), cero()));
  const sujeta = r2(D.max(gananciaNeta.minus(conPorcentual).minus(gni).minus(especial).minus(cargas), 0));
  // Escala del art. 94 con los límites prorrateados
  const tramos = t.tramos.map((x) => ({ desde: p(x.desde), hasta: x.hasta ? p(x.hasta) : null, fijo: p(x.fijo), porcentaje: x.porcentaje }));
  const tramo = [...tramos].reverse().find((x) => sujeta.gt(x.desde)) ?? tramos[0];
  const impuesto = sujeta.gt(0) ? r2(tramo.fijo.plus(sujeta.minus(tramo.desde).times(tramo.porcentaje).div(100))) : cero();
  const calculado = r2(impuesto.minus(d.retenidoAnterior));
  const tope35 = D.max(d.brutaRecibo, 0).times(0.35);
  const topeMes = r2(d.netoRecibo ? D.min(tope35, D.max(d.netoRecibo, 0)) : tope35);
  let importe: Dec;
  let noRetenido = cero();
  if (calculado.lt(0)) importe = D.max(calculado, d.retenidoEmpresa.neg()); // devolución, hasta lo retenido por la empresa
  else if (calculado.gt(topeMes)) { importe = topeMes; noRetenido = calculado.minus(topeMes); }
  else importe = calculado;
  importe = r2(importe);
  return {
    importe,
    hoja: {
      mes: d.mes, bruta: f(d.bruta), aportes: f(d.aportes), gananciaNeta: f(gananciaNeta),
      deducciones: [...informado.entries()].map(([tipo, v]) => ({ tipo, nombre: NOMBRE_DEDUCCION[tipo], informado: f(v), computado: f(computado.get(tipo) ?? cero()) })),
      personales: { gni: f(gni), especial: f(especial), cargas: f(cargas) },
      sujeta: f(sujeta), tramo: { desde: f(tramo.desde), fijo: f(tramo.fijo), porcentaje: tramo.porcentaje.toFixed(2) }, impuesto: f(impuesto),
      retenidoAnterior: f(d.retenidoAnterior), calculado: f(calculado), topeMes: f(topeMes), importe: f(importe), noRetenido: f(noRetenido), avisos,
    },
  };
}
