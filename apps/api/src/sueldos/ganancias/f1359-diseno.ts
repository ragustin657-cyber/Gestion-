import { CampoLsd } from '../lsd-diseno';
import { DatosF1359Empleado, PAGOS_F1359 } from './f1359-datos';

/**
 * Diseño de registro del F.1359 v2.0 (ARCA, DJ anuales, finales e informativas 2025; docs/referencias/arca-F1359-v2.0-manual.txt; spec E32 §7).
 * Importes con 2 decimales implícitos; IS admite signo.
 */
export interface DatosCabecera { cuit: string; periodo: string; tipo: 1 | 2 | 4 }

const c = <T>(nombre: string, largo: number, tipo: CampoLsd<T>['tipo'], valor: CampoLsd<T>['valor']): CampoLsd<T> => ({ nombre, largo, tipo, valor });
const fijo = (v: string) => () => v;
const cero = () => 0;
const i15 = (nombre: string, f: (d: DatosF1359Empleado) => string | number) => c<DatosF1359Empleado>(nombre, 15, 'I', f);
const tipo = (t: string): CampoLsd<DatosF1359Empleado> => c('Tipo de registro', 2, 'C', fijo(t));
const cuil = c<DatosF1359Empleado>('CUIL', 11, 'N', (d) => d.cuil);

export const F1359_01: CampoLsd<DatosCabecera>[] = [
  c('Tipo de registro', 2, 'C', fijo('01')), c('CUIT agente de retención', 11, 'N', (d) => d.cuit), c('Período informado', 6, 'N', (d) => d.periodo),
  c('Secuencia', 2, 'C', fijo('00')), c('Código de impuesto', 4, 'C', fijo('0103')), c('Código de concepto', 3, 'C', fijo('593')),
  c('Número de formulario', 4, 'C', fijo('1359')), c('Tipo de presentación', 1, 'N', (d) => d.tipo), c('Versión del sistema', 5, 'C', fijo('00200')),
];

export const F1359_02: CampoLsd<DatosF1359Empleado>[] = [
  tipo('02'), cuil, c('Período trabajado desde', 8, 'N', (d) => d.desde), c('Período trabajado hasta', 8, 'N', (d) => d.hasta), c('Meses', 2, 'N', (d) => d.meses),
  c('Beneficio', 1, 'N', fijo('1')), c('Personal de pozo', 1, 'N', cero), c('Actor', 1, 'N', cero), c('Medida cautelar', 1, 'N', cero), c('Poder judicial', 1, 'N', cero),
];

export const F1359_03: CampoLsd<DatosF1359Empleado>[] = [
  tipo('03'), cuil, i15('Remuneración bruta', (d) => d.r03.bruta), i15('Retribuciones no habituales', cero), i15('SAC primera cuota', (d) => d.r03.sac1),
  i15('SAC segunda cuota', (d) => d.r03.sac2), i15('Otros empleos - remuneración bruta', (d) => d.r03.otrosBruta), i15('Otros empleos - no habituales', cero),
  i15('Otros empleos - SAC primera cuota', cero), i15('Otros empleos - SAC segunda cuota', cero), i15('Ajustes de períodos anteriores', cero),
  i15('Otros empleos - ajustes', cero), i15('Total remuneración gravada', (d) => d.r03.total),
];

export const F1359_04: CampoLsd<DatosF1359Empleado>[] = [
  tipo('04'), cuil, i15('Asignaciones familiares', (d) => d.r04.asignaciones), i15('Intereses préstamos al empleador', (d) => d.r04.intereses),
  i15('Indemnizaciones', (d) => d.r04.indemnizaciones), i15('Tierra del Fuego', cero), i15('Petroleros - personal de pozo', cero), i15('Cursos y seminarios', (d) => d.r04.cursos),
  i15('Indumentaria y equipamiento provistos', (d) => d.r04.indumentaria), i15('Ajustes de períodos anteriores', cero),
  ...['asignaciones', 'intereses', 'indemnizaciones', 'Tierra del Fuego', 'petroleros', 'cursos', 'indumentaria', 'ajustes'].map((n) => i15(`Otros empleos - ${n}`, cero)),
  i15('Total remuneración no gravada / exenta', (d) => d.r04.totalExento), i15('Total remuneraciones', (d) => d.r04.totalRemuneraciones),
  i15('Poder judicial', cero), i15('Otros empleos - poder judicial', cero),
];

type K5 = keyof DatosF1359Empleado['r05'];
/** Campos 3 a 32 del registro 05 en orden (null = siempre 0). */
const CAMPOS_05: (K5 | null)[] = [
  'aportesSS', 'otrosAportes', 'cajas', null, 'aportesOS', null, 'sindical', null, 'cuotasMedicas', 'seguroMuerte', 'seguroMixto', null, 'sepelio', 'corredores',
  'donaciones', 'alquiler', null, 'gastosMedicos', 'hipotecarios', 'sgr', 'domestico', null, null, null, 'seguroRetiro', 'indumentaria', 'educacion', null, null, null,
];
export const F1359_05: CampoLsd<DatosF1359Empleado>[] = [
  tipo('05'), cuil, ...CAMPOS_05.map((k, i) => i15(`Campo ${i + 3}${k ? ` (${k})` : ''}`, k ? (d) => d.r05[k] : cero)), i15('Total deducciones generales', (d) => d.r05.total),
];

export const F1359_06: CampoLsd<DatosF1359Empleado>[] = [
  tipo('06'), cuil, i15('Ganancia no imponible', (d) => d.r06.gni), i15('Cónyuge', (d) => d.r06.conyuge), c('Hijos al 50 %', 2, 'N', (d) => d.r06.hijos50),
  c('Hijos al 100 %', 2, 'N', (d) => d.r06.hijos100), i15('Hijos ($)', (d) => d.r06.hijos), c('Hijos incapacitados al 50 %', 2, 'N', (d) => d.r06.incapacitados50),
  c('Hijos incapacitados al 100 %', 2, 'N', (d) => d.r06.incapacitados100), i15('Hijos incapacitados ($)', (d) => d.r06.incapacitados),
  i15('Total cargas de familia', (d) => d.r06.totalCargas), i15('Deducción especial', (d) => d.r06.especial), i15('Deducción especial adicional doceava parte', cero),
  i15('Deducción específica', cero), i15('Total deducciones art. 30', (d) => d.r06.total), c('Hijos 18 a 24 educación al 50 %', 2, 'N', cero), c('Hijos 18 a 24 educación al 100 %', 2, 'N', cero),
];

export const F1359_07: CampoLsd<DatosF1359Empleado>[] = [
  tipo('07'), cuil, ...PAGOS_F1359.map((t) => i15(t, (d) => d.r07[t])), i15('Total pagos a cuenta', (d) => d.r07.total),
];

export const F1359_08: CampoLsd<DatosF1359Empleado>[] = [
  tipo('08'), cuil, i15('Remuneración sujeta a impuesto', (d) => d.r08.sujeta), c('Alícuota art. 94', 2, 'C', (d) => d.r08.alicuota),
  i15('Impuesto determinado', (d) => d.r08.determinado), i15('Impuesto retenido', (d) => d.r08.retenido), c('Subtotal saldo', 15, 'IS', (d) => d.r08.subtotal),
  i15('Impuesto autorretenido', cero), c('Saldo determinado', 15, 'IS', (d) => d.r08.saldo),
];

export const LARGOS_F1359: Record<string, number> = { '01': 38, '02': 36, '03': 178, '04': 313, '05': 478, '06': 160, '07': 178, '08': 105 };
export const REGISTROS_EMPLEADO = [F1359_02, F1359_03, F1359_04, F1359_05, F1359_06, F1359_07, F1359_08];
