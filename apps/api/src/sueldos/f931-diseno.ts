import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

/** Datos de un empleado para una línea del F.931 (importes ya sumados y topeados). */
export interface DatosF931 {
  cuil: string; apellidoNombre: string; conyuge: boolean; cantidadHijos: number; codigoSituacion: number; codigoCondicion: number; codigoActividad: number;
  codigoZona: number; codigoModalidad: number; codigoObraSocial: string; adherentes: number; codigoSiniestrado: number; regimen: number; diaInicioRevista: number;
  convencionado: boolean; localidad: string; tipoEmpresa: number; scvo: boolean;
  remuneracionTotal: Dec; imponible1: Dec; imponible2: Dec; imponible3: Dec; imponible4: Dec; imponible5: Dec; imponible8: Dec; imponible9: Dec; imponible11: Dec;
  sueldoAdicionales: Dec; sac: Dec; horasExtrasImporte: Dec; noRemunerativo: Dec; detraccion: Dec; diasTrabajados: number; horasExtras: number; vacaciones?: Dec;
}

export interface CampoF931 { numero: number; nombre: string; largo: number; tipo: 'N' | 'C' | 'I'; valor: (d: DatosF931) => string | number | Dec }

const cero = () => 0;
const b = (x: boolean) => (x ? 1 : 0);
const campos: [string, number, CampoF931['tipo'], CampoF931['valor']][] = [
  ['CUIL', 11, 'N', (d) => d.cuil],
  ['Apellido y nombre', 30, 'C', (d) => d.apellidoNombre],
  ['Cónyuge', 1, 'N', (d) => b(d.conyuge)],
  ['Cantidad de hijos', 2, 'N', (d) => d.cantidadHijos],
  ['Código de situación', 2, 'N', (d) => d.codigoSituacion],
  ['Código de condición', 2, 'N', (d) => d.codigoCondicion],
  ['Código de actividad', 3, 'N', (d) => d.codigoActividad],
  ['Código de zona', 2, 'N', (d) => d.codigoZona],
  ['Porcentaje de aporte adicional SS', 5, 'I', cero],
  ['Código de modalidad de contratación', 3, 'N', (d) => d.codigoModalidad],
  ['Código de obra social', 6, 'C', (d) => d.codigoObraSocial],
  ['Cantidad de adherentes', 2, 'N', (d) => d.adherentes],
  ['Remuneración total', 12, 'I', (d) => d.remuneracionTotal],
  ['Remuneración imponible 1', 12, 'I', (d) => d.imponible1],
  ['Asignaciones familiares pagadas', 9, 'I', cero],
  ['Importe aporte voluntario', 9, 'I', cero],
  ['Importe adicional OS', 9, 'I', cero],
  ['Importe excedentes aportes SS', 9, 'I', cero],
  ['Importe excedentes aportes OS', 9, 'I', cero],
  ['Provincia / localidad', 50, 'C', (d) => d.localidad],
  ['Remuneración imponible 2', 12, 'I', (d) => d.imponible2],
  ['Remuneración imponible 3', 12, 'I', (d) => d.imponible3],
  ['Remuneración imponible 4', 12, 'I', (d) => d.imponible4],
  ['Código de siniestrado', 2, 'N', (d) => d.codigoSiniestrado],
  ['Marca de corresponde reducción', 1, 'N', cero],
  ['Capital de recomposición LRT', 9, 'I', cero],
  ['Tipo de empresa', 1, 'N', (d) => d.tipoEmpresa],
  ['Aporte adicional OS', 9, 'I', cero],
  ['Régimen', 1, 'N', (d) => d.regimen],
  ['Situación de revista 1', 2, 'N', (d) => d.codigoSituacion],
  ['Día inicio situación de revista 1', 2, 'N', (d) => d.diaInicioRevista],
  ['Situación de revista 2', 2, 'N', cero],
  ['Día inicio situación de revista 2', 2, 'N', cero],
  ['Situación de revista 3', 2, 'N', cero],
  ['Día inicio situación de revista 3', 2, 'N', cero],
  ['Sueldo + adicionales', 12, 'I', (d) => d.sueldoAdicionales],
  ['SAC', 12, 'I', (d) => d.sac],
  ['Horas extras', 12, 'I', (d) => d.horasExtrasImporte],
  ['Zona desfavorable', 12, 'I', cero],
  ['Vacaciones', 12, 'I', (d) => d.vacaciones ?? 0],
  ['Cantidad de días trabajados', 9, 'I', (d) => d.diasTrabajados],
  ['Remuneración imponible 5', 12, 'I', (d) => d.imponible5],
  ['Trabajador convencionado', 1, 'N', (d) => b(d.convencionado)],
  ['Remuneración imponible 6', 12, 'I', cero],
  ['Tipo de operación', 1, 'N', cero],
  ['Adicionales', 12, 'I', cero],
  ['Premios', 12, 'I', cero],
  ['Remuneración imponible 8', 12, 'I', (d) => d.imponible8],
  ['Remuneración imponible 7', 12, 'I', cero],
  ['Cantidad de horas extras', 3, 'N', (d) => d.horasExtras],
  ['Conceptos no remunerativos', 12, 'I', (d) => d.noRemunerativo],
  ['Maternidad', 12, 'I', cero],
  ['Rectificación de remuneración', 9, 'I', cero],
  ['Remuneración imponible 9', 12, 'I', (d) => d.imponible9],
  ['Contribución tarea diferencial', 9, 'I', cero],
  ['Horas trabajadas', 3, 'N', cero],
  ['Seguro colectivo de vida obligatorio', 1, 'N', (d) => b(d.scvo)],
  ['Importe a detraer (Ley 27.430)', 12, 'I', (d) => d.detraccion],
  ['Incremento salarial', 12, 'I', cero],
  ['Remuneración imponible 11', 12, 'I', (d) => d.imponible11],
];

/** Diseño de registro de importación de SICOSS (versión 42): 60 campos, 499 caracteres. */
export const CAMPOS_F931: CampoF931[] = campos.map(([nombre, largo, tipo, valor], i) => ({ numero: i + 1, nombre, largo, tipo, valor }));

/** Mayúsculas, sin tildes ni eñes, solo ASCII imprimible. */
export function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Línea del F.931 de un empleado (lanza si un importe no entra en su campo). */
export function lineaF931(d: DatosF931, legajo: number): string {
  return CAMPOS_F931.map((c) => {
    const v = c.valor(d);
    if (c.tipo === 'C') return normalizarTexto(String(v)).slice(0, c.largo).padEnd(c.largo);
    if (c.tipo === 'N') {
      const t = String(Math.max(0, Math.trunc(Number(v)))).padStart(c.largo, '0');
      if (t.length > c.largo) throw new Error(`El importe de ${c.nombre} del legajo ${legajo} excede el largo del archivo`);
      return t;
    }
    const t = new D(v as Dec | number).toFixed(2).replace('.', ',');
    if (t.length > c.largo) throw new Error(`El importe de ${c.nombre} del legajo ${legajo} excede el largo del archivo`);
    return t.padStart(c.largo);
  }).join('');
}
