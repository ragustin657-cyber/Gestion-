import type { Prisma } from '@prisma/client';
import { codigoArcaPorDefecto } from './lsd-conceptos';

/** Convenio de Comercio precargado (spec §3): categorías sin básicos (se cargan las escalas vigentes). */
export const CONVENIO_COMERCIO = { codigo: 'CCT130-75', nombre: 'Comercio (CCT 130/75)', horasMensuales: 200 };
export const CATEGORIAS_COMERCIO = [
  'Maestranza A', 'Maestranza B', 'Maestranza C',
  'Administrativo A', 'Administrativo B', 'Administrativo C', 'Administrativo D', 'Administrativo E', 'Administrativo F',
  'Cajero A', 'Cajero B', 'Cajero C',
  'Auxiliar A', 'Auxiliar B', 'Auxiliar C',
  'Auxiliar especializado A', 'Auxiliar especializado B',
  'Vendedor A', 'Vendedor B', 'Vendedor C', 'Vendedor D',
];
type ConceptoModelo = { codigo: string; nombre: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO'; tipo: 'BASICO' | 'ANTIGUEDAD' | 'PORCENTAJE' | 'HORAS_EXTRA' | 'AUSENCIA' | 'FIJO' | 'DESCUENTO_LEY' | 'VACACIONES' | 'GANANCIAS'; parametros: Record<string, unknown>; soloAfiliados?: boolean; destino?: 'SEGURIDAD_SOCIAL' | 'OBRA_SOCIAL' | 'SINDICAL' };
/** Conceptos precargados de Comercio (spec §4), editables. */
export const CONCEPTOS_COMERCIO: ConceptoModelo[] = [
  { codigo: '100', nombre: 'Sueldo básico', clase: 'REMUNERATIVO', tipo: 'BASICO', parametros: {} },
  { codigo: '110', nombre: 'Antigüedad', clase: 'REMUNERATIVO', tipo: 'ANTIGUEDAD', parametros: { pctPorAnio: 1 } },
  { codigo: '120', nombre: 'Presentismo', clase: 'REMUNERATIVO', tipo: 'PORCENTAJE', parametros: { pct: 8.33, base: 'BASICO_MAS_ANTIGUEDAD', pierdeConAusencia: true } },
  { codigo: '130', nombre: 'Horas extra 50 %', clase: 'REMUNERATIVO', tipo: 'HORAS_EXTRA', parametros: { recargoPct: 50 } },
  { codigo: '131', nombre: 'Horas extra 100 %', clase: 'REMUNERATIVO', tipo: 'HORAS_EXTRA', parametros: { recargoPct: 100 } },
  { codigo: '140', nombre: 'Ausencias injustificadas', clase: 'REMUNERATIVO', tipo: 'AUSENCIA', parametros: {} },
  { codigo: '150', nombre: 'Vacaciones', clase: 'REMUNERATIVO', tipo: 'VACACIONES', parametros: { divisor: 25 } },
  { codigo: '151', nombre: 'Descuento días de vacaciones', clase: 'REMUNERATIVO', tipo: 'VACACIONES', parametros: { divisor: 30, descuenta: true } },
  { codigo: '500', nombre: 'Jubilación', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 11, base: 'REMUNERATIVO', tope: 'BASE_MAXIMA' }, destino: 'SEGURIDAD_SOCIAL' },
  { codigo: '210', nombre: 'Comisiones', clase: 'NO_REMUNERATIVO', tipo: 'FIJO', parametros: {} },
  { codigo: '510', nombre: 'Ley 19.032', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 3, base: 'REMUNERATIVO', tope: 'BASE_MAXIMA' }, destino: 'SEGURIDAD_SOCIAL' },
  { codigo: '520', nombre: 'Obra social', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 3, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO', tope: 'BASE_MAXIMA' }, destino: 'OBRA_SOCIAL' },
  { codigo: '530', nombre: 'FAECYS', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 0.5, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }, destino: 'SINDICAL' },
  { codigo: '540', nombre: 'Sindicato', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 2, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }, soloAfiliados: true, destino: 'SINDICAL' },
  { codigo: '560', nombre: 'Impuesto a las ganancias', clase: 'DESCUENTO', tipo: 'GANANCIAS', parametros: {} },
];

/** Carga el convenio de Comercio, sus categorías y los conceptos en una empresa nueva. */
export async function cargarSueldosModelo(tx: Prisma.TransactionClient, empresaId: string) {
  const conv = await tx.convenio.create({ data: { empresaId, ...CONVENIO_COMERCIO } });
  await tx.categoria.createMany({ data: CATEGORIAS_COMERCIO.map((nombre, i) => ({ empresaId, convenioId: conv.id, nombre, orden: i + 1 })) });
  const cuenta = async (codigo: string) => (await tx.cuentaContable.findFirst({ where: { empresaId, codigo }, select: { id: true } }))?.id ?? null;
  const cfg = await tx.configuracionSueldos.create({ data: {
    empresaId, cuentaSueldosId: await cuenta('5.2.09'), cuentaContribucionesId: await cuenta('5.2.10'), cuentaSueldosAPagarId: await cuenta('2.1.03.001'),
    cuentaCargasSocialesId: await cuenta('2.1.03.002'), cuentaRetencionesSindicalesId: await cuenta('2.1.03.003'), cuentaIndemnizacionesId: await cuenta('5.2.11'), anioInicioVacaciones: new Date().getUTCFullYear(),
  } });
  const cuentaGanancias = await cuenta('2.1.02.002');
  await tx.concepto.createMany({ data: CONCEPTOS_COMERCIO.map((c) => ({
    // Presentismo, FAECYS y sindicato son de Comercio: no se aplican a otros convenios (E22 §2.8)
    convenioId: ['120', '530', '540'].includes(c.codigo) ? conv.id : null,
    empresaId, codigo: c.codigo, nombre: c.nombre, clase: c.clase, tipo: c.tipo, parametros: c.parametros as Prisma.InputJsonValue, orden: Number(c.codigo), soloAfiliados: !!c.soloAfiliados,
    destino: c.destino ?? 'OTRO', codigoArca: codigoArcaPorDefecto({ ...c, destino: c.destino ?? 'OTRO' }), cuentaContableId: c.destino === 'SINDICAL' ? cfg.cuentaRetencionesSindicalesId : c.tipo === 'GANANCIAS' ? cuentaGanancias : null,
  })) });
  // Concepto de comisiones de vendedores (E24 §7)
  const comisiones = await tx.concepto.findFirst({ where: { empresaId, codigo: '210' }, select: { id: true } });
  if (comisiones) await tx.configuracionSueldos.update({ where: { id: cfg.id }, data: { conceptoComisionesId: comisiones.id } });
  if (cfg.cuentaCargasSocialesId) await tx.contribucionPatronal.createMany({ data: CONTRIBUCIONES_MODELO.map((c) => ({ empresaId, ...c, cuentaContableId: cfg.cuentaCargasSocialesId!, desdeAnio: 2026, desdeMes: 1 })) });
  await tx.parametroPrevisional.create({ data: { empresaId, anio: 2026, mes: 1, baseMaximaAportes: 3500000, detraccion: 7003.68 } });
}

/** Contribuciones patronales del régimen general (spec E19 §2), editables. */
export const CONTRIBUCIONES_MODELO: { codigo: string; nombre: string; destino: 'SEGURIDAD_SOCIAL' | 'OBRA_SOCIAL' | 'ART' | 'SEGURO_VIDA'; alicuota: number; importeFijo: number; aplicaDetraccion: boolean }[] = [
  { codigo: 'SIPA', nombre: 'Jubilación (SIPA)', destino: 'SEGURIDAD_SOCIAL', alicuota: 10.77, importeFijo: 0, aplicaDetraccion: true },
  { codigo: 'PAMI', nombre: 'INSSJP (Ley 19.032)', destino: 'SEGURIDAD_SOCIAL', alicuota: 1.59, importeFijo: 0, aplicaDetraccion: true },
  { codigo: 'FNE', nombre: 'Fondo Nacional de Empleo', destino: 'SEGURIDAD_SOCIAL', alicuota: 0.94, importeFijo: 0, aplicaDetraccion: true },
  { codigo: 'AAFF', nombre: 'Asignaciones familiares', destino: 'SEGURIDAD_SOCIAL', alicuota: 4.7, importeFijo: 0, aplicaDetraccion: true },
  { codigo: 'OS', nombre: 'Obra social', destino: 'OBRA_SOCIAL', alicuota: 6, importeFijo: 0, aplicaDetraccion: false },
  { codigo: 'ART', nombre: 'ART', destino: 'ART', alicuota: 2.5, importeFijo: 1500, aplicaDetraccion: false },
  { codigo: 'SCVO', nombre: 'Seguro colectivo de vida obligatorio', destino: 'SEGURO_VIDA', alicuota: 0, importeFijo: 1000, aplicaDetraccion: false },
];
