import { Concepto, Liquidacion, Prisma, ReciboSueldo, ReciboSueldoRenglon } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const r2 = (x: Dec) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const TIPOS_SUELDO = ['BASICO', 'ANTIGUEDAD', 'PORCENTAJE', 'AUSENCIA', 'FIJO'];

export interface ImportesRecibo {
  remuneracionTotal: Dec; imponible1: Dec; imponible2: Dec; imponible3: Dec; imponible4: Dec; imponible5: Dec; imponible8: Dec; imponible9: Dec; imponible11: Dec;
  detraccion: Dec; noRemunerativo: Dec; sueldoAdicionales: Dec; sac: Dec; horasExtrasImporte: Dec; vacaciones: Dec;
}

/**
 * Importes de un recibo para la declaración de seguridad social (topes, detracción, sin los conceptos indemnizatorios).
 * Los usan el archivo de SICOSS (sumados por empleado en el mes) y el Libro de Sueldos Digital (por liquidación), spec E30 §4.4.
 */
export function importesRecibo(
  r: ReciboSueldo & { renglones: ReciboSueldoRenglon[] }, liq: Liquidacion, param: { baseMaxima: Dec | null; detraccion: Dec },
  conceptos: Map<string, Concepto>, o: { esSac: boolean; esFinal: boolean },
): ImportesRecibo {
  const rem = D.max(new D(r.totalRemunerativo), 0);
  // Los conceptos indemnizatorios de la final (300 a 340) no se informan
  const noRem = new D(r.totalNoRemunerativo).minus(r.renglones.filter((x) => !x.conceptoId && Number(x.codigo) >= 300 && Number(x.codigo) < 400).reduce((s, x) => s.plus(x.importe), new D(0)));
  const sacFinal = o.esFinal ? r.renglones.filter((x) => x.codigo === '200' && !x.conceptoId).reduce((s, x) => s.plus(x.importe), new D(0)) : new D(0);
  // Parámetros copiados al cerrar; los vigentes solo para liquidaciones cerradas antes de la Entrega 22
  const baseMaxima = liq.baseMaximaAportes ?? (liq.detraccion !== null ? null : param.baseMaxima);
  const detraccion = liq.detraccion ?? param.detraccion;
  const tope = baseMaxima ? (o.esSac ? baseMaxima.div(2) : o.esFinal ? baseMaxima.times(1.5) : baseMaxima) : null;
  const conTope = tope ? D.min(rem, tope) : rem;
  const det = D.min(rem, r2(o.esSac ? detraccion.div(2) : detraccion.times(r.diasTrabajados).div(30).plus(sacFinal.gt(0) ? detraccion.div(2) : 0)));
  const res: ImportesRecibo = {
    remuneracionTotal: rem.plus(noRem), imponible1: conTope, imponible4: conTope, imponible5: conTope, imponible2: rem, imponible3: rem, imponible8: rem, imponible9: rem,
    imponible11: rem.minus(det), detraccion: det, noRemunerativo: noRem, sueldoAdicionales: new D(0), sac: new D(0), horasExtrasImporte: new D(0), vacaciones: new D(0),
  };
  for (const x of r.renglones.filter((y) => y.clase === 'REMUNERATIVO')) {
    if (x.codigo === '200' && !x.conceptoId) { res.sac = res.sac.plus(x.importe); continue; }
    const tipo = x.conceptoId ? conceptos.get(x.conceptoId)?.tipo : undefined;
    // Vacaciones (E21): el 150 va al campo 40; el descuento de días (151, negativo) resta en sueldo + adicionales
    if (tipo === 'VACACIONES') { if (new D(x.importe).gt(0)) res.vacaciones = res.vacaciones.plus(x.importe); else res.sueldoAdicionales = res.sueldoAdicionales.plus(x.importe); continue; }
    if (tipo === 'HORAS_EXTRA') res.horasExtrasImporte = res.horasExtrasImporte.plus(x.importe);
    else if (tipo && TIPOS_SUELDO.includes(tipo)) res.sueldoAdicionales = res.sueldoAdicionales.plus(x.importe);
  }
  return res;
}
