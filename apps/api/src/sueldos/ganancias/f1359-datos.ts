import { Prisma } from '@prisma/client';
import { AcumuladoEmpleado, RUBROS, totalExento } from './acumulado';
import { HojaGanancias, TipoDeduccion } from './calculo';
import type { TipoPagoACuenta } from './f572-xml';
import type { CargasDetalle } from './retencion.service';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const f = (x: Dec | number | string) => new D(x).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const aaaammdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Códigos de alícuota de la Tabla 3 del manual del F.1359. */
export const ALICUOTAS_F1359: Record<string, string> = { 0: '00', 5: '01', 9: '02', 12: '03', 15: '04', 19: '05', 23: '06', 27: '07', 31: '08', 35: '09' };

/** Campos del registro 05 por tipo de deducción del F.572 (E32 §7). */
const CAMPO_DEDUCCION: Record<TipoDeduccion, keyof DatosF1359Empleado['r05'] | null> = {
  CUOTAS_MEDICAS: 'cuotasMedicas', SEGURO_MUERTE: 'seguroMuerte', SEGURO_MIXTO: 'seguroMixto', SEGURO_RETIRO: 'seguroRetiro', DONACIONES: 'donaciones',
  INTERESES_HIPOTECARIOS: 'hipotecarios', SEPELIO: 'sepelio', GASTOS_MEDICOS: 'gastosMedicos', INDUMENTARIA: 'indumentaria', ALQUILER: 'alquiler',
  SERVICIO_DOMESTICO: 'domestico', SGR: 'sgr', VEHICULOS_CORREDORES: 'corredores', INTERESES_CORREDORES: 'corredores', EDUCACION: 'educacion',
  CAJAS_JUBILACION: 'cajas', OTRA: null,
};
export const PAGOS_F1359: Exclude<TipoPagoACuenta, 'OTRO'>[] = ['ADUANERAS', 'CHEQUE_BANCARIO', 'CHEQUE_MOVIMIENTOS', 'EFECTIVO_AGENCIAS', 'EFECTIVO_TRANSPORTE', 'DOLAR_ATESORAMIENTO', 'DOLAR_BIENES_EXTERIOR', 'DOLAR_SERVICIOS_NO_RESIDENTES', 'DOLAR_AGENCIAS', 'DOLAR_TRANSPORTE'];

/** Importes de un empleado para los registros 02 a 08 del F.1359 (texto con 2 decimales). */
export interface DatosF1359Empleado {
  cuil: string; desde: string; hasta: string; meses: number;
  r03: { bruta: string; sac1: string; sac2: string; otrosBruta: string; total: string };
  r04: { asignaciones: string; intereses: string; indemnizaciones: string; cursos: string; indumentaria: string; totalExento: string; totalRemuneraciones: string };
  r05: {
    aportesSS: string; otrosAportes: string; cajas: string; aportesOS: string; sindical: string; cuotasMedicas: string; seguroMuerte: string; seguroMixto: string;
    sepelio: string; corredores: string; donaciones: string; alquiler: string; gastosMedicos: string; hipotecarios: string; sgr: string; domestico: string;
    seguroRetiro: string; indumentaria: string; educacion: string; total: string;
  };
  r06: { gni: string; conyuge: string; hijos50: number; hijos100: number; hijos: string; incapacitados50: number; incapacitados100: number; incapacitados: string; totalCargas: string; especial: string; total: string };
  r07: Record<Exclude<TipoPagoACuenta, 'OTRO'>, string> & { total: string };
  r08: { sujeta: string; alicuota: string; determinado: string; retenido: string; subtotal: string; saldo: string };
  avisos: string[];
}

/**
 * Arma los datos del F.1359 de un empleado a partir del acumulado y de la hoja de cálculo (anual o final), con los totales
 * y las fórmulas de control del manual (E32 §7).
 */
export function armarF1359Empleado(
  a: AcumuladoEmpleado, hoja: HojaGanancias, cargas: CargasDetalle,
  o: { cuil: string; anio: number; ingreso: Date; egreso: Date | null; retenido: Dec; pagosACuenta: Dec },
): DatosF1359Empleado {
  const avisos: string[] = [];
  const inicio = new Date(Date.UTC(o.anio, 0, 1));
  const fin = new Date(Date.UTC(o.anio, 11, 31));
  const desde = o.ingreso > inicio ? o.ingreso : inicio;
  const hasta = o.egreso && o.egreso < fin ? o.egreso : fin;
  const meses = Math.max(1, Math.min(12, hasta.getUTCMonth() - desde.getUTCMonth() + 1));
  const bruta = a.brutaSinSac.plus(a.previo.bruta);
  const totalGravada = bruta.plus(a.sac1).plus(a.sac2).plus(a.otros.bruta);
  const exenta = totalExento(a);
  const r05 = Object.fromEntries(['aportesSS', 'otrosAportes', 'cajas', 'aportesOS', 'sindical', 'cuotasMedicas', 'seguroMuerte', 'seguroMixto', 'sepelio', 'corredores', 'donaciones', 'alquiler', 'gastosMedicos', 'hipotecarios', 'sgr', 'domestico', 'seguroRetiro', 'indumentaria', 'educacion'].map((k) => [k, new D(0)])) as Record<string, Dec>;
  r05.aportesSS = a.aportesSS.plus(a.previo.aportes);
  r05.otrosAportes = a.otros.aportes;
  r05.aportesOS = a.aportesOS;
  r05.sindical = a.aportesSindical;
  for (const d of hoja.deducciones) { const k = CAMPO_DEDUCCION[d.tipo]; if (k) r05[k] = r05[k].plus(d.computado); }
  const totalGenerales = Object.values(r05).reduce((s, x) => s.plus(x), new D(0));
  const totalCargas = cargas.conyuge.plus(cargas.hijos).plus(cargas.incapacitados);
  const totalArt30 = new D(hoja.personales.gni).plus(hoja.personales.especial).plus(totalCargas);
  if (totalArt30.gt(totalGravada.plus(exenta))) avisos.push('Las deducciones del art. 30 superan las remuneraciones: ARCA puede observar la presentación');
  const sujeta = D.max(totalGravada.minus(totalGenerales).minus(totalArt30), 0);
  const determinado = new D(hoja.impuesto);
  const subtotal = determinado.minus(o.retenido);
  const porc = Number(hoja.tramo.porcentaje);
  const alicuota = sujeta.isZero() ? '00' : ALICUOTAS_F1359[String(porc)];
  if (!alicuota) throw new Error(`El porcentaje ${porc} % de la escala no está en la Tabla 3 del F.1359`);
  const r07 = Object.fromEntries(PAGOS_F1359.map((t) => [t, f(a.pagosPorTipo[t] ?? 0)])) as DatosF1359Empleado['r07'];
  r07.total = f(o.pagosACuenta);
  return {
    cuil: o.cuil.replace(/\D/g, ''), desde: aaaammdd(desde), hasta: aaaammdd(hasta), meses,
    r03: { bruta: f(bruta), sac1: f(a.sac1), sac2: f(a.sac2), otrosBruta: f(a.otros.bruta), total: f(totalGravada) },
    r04: {
      asignaciones: f(a.exentos.ASIGNACIONES_FAMILIARES), intereses: f(a.exentos.INTERESES_PRESTAMOS), indemnizaciones: f(a.exentos.INDEMNIZACIONES),
      cursos: f(a.exentos.CURSOS_SEMINARIOS), indumentaria: f(a.exentos.INDUMENTARIA), totalExento: f(exenta), totalRemuneraciones: f(totalGravada.plus(exenta)),
    },
    r05: { ...(Object.fromEntries(Object.entries(r05).map(([k, v]) => [k, f(v)])) as unknown as DatosF1359Empleado['r05']), total: f(totalGenerales) },
    r06: {
      gni: f(hoja.personales.gni), conyuge: f(cargas.conyuge), hijos50: cargas.hijos50, hijos100: cargas.hijos100, hijos: f(cargas.hijos),
      incapacitados50: cargas.incapacitados50, incapacitados100: cargas.incapacitados100, incapacitados: f(cargas.incapacitados), totalCargas: f(totalCargas),
      especial: f(hoja.personales.especial), total: f(totalArt30),
    },
    r07,
    r08: { sujeta: f(sujeta), alicuota, determinado: f(determinado), retenido: f(o.retenido), subtotal: f(subtotal), saldo: f(subtotal.minus(o.pagosACuenta)) },
    avisos,
  };
}

export const RUBROS_F1359 = RUBROS;
