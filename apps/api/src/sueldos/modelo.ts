import type { Prisma } from '@prisma/client';

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
type ConceptoModelo = { codigo: string; nombre: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO'; tipo: 'BASICO' | 'ANTIGUEDAD' | 'PORCENTAJE' | 'HORAS_EXTRA' | 'AUSENCIA' | 'FIJO' | 'DESCUENTO_LEY'; parametros: Record<string, unknown>; soloAfiliados?: boolean };
/** Conceptos precargados de Comercio (spec §4), editables. */
export const CONCEPTOS_COMERCIO: ConceptoModelo[] = [
  { codigo: '100', nombre: 'Sueldo básico', clase: 'REMUNERATIVO', tipo: 'BASICO', parametros: {} },
  { codigo: '110', nombre: 'Antigüedad', clase: 'REMUNERATIVO', tipo: 'ANTIGUEDAD', parametros: { pctPorAnio: 1 } },
  { codigo: '120', nombre: 'Presentismo', clase: 'REMUNERATIVO', tipo: 'PORCENTAJE', parametros: { pct: 8.33, base: 'BASICO_MAS_ANTIGUEDAD', pierdeConAusencia: true } },
  { codigo: '130', nombre: 'Horas extra 50 %', clase: 'REMUNERATIVO', tipo: 'HORAS_EXTRA', parametros: { recargoPct: 50 } },
  { codigo: '131', nombre: 'Horas extra 100 %', clase: 'REMUNERATIVO', tipo: 'HORAS_EXTRA', parametros: { recargoPct: 100 } },
  { codigo: '140', nombre: 'Ausencias injustificadas', clase: 'REMUNERATIVO', tipo: 'AUSENCIA', parametros: {} },
  { codigo: '500', nombre: 'Jubilación', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 11, base: 'REMUNERATIVO' } },
  { codigo: '510', nombre: 'Ley 19.032', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 3, base: 'REMUNERATIVO' } },
  { codigo: '520', nombre: 'Obra social', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 3, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' } },
  { codigo: '530', nombre: 'FAECYS', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 0.5, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' } },
  { codigo: '540', nombre: 'Sindicato', clase: 'DESCUENTO', tipo: 'DESCUENTO_LEY', parametros: { pct: 2, base: 'REMUNERATIVO_MAS_NO_REMUNERATIVO' }, soloAfiliados: true },
];

/** Carga el convenio de Comercio, sus categorías y los conceptos en una empresa nueva. */
export async function cargarSueldosModelo(tx: Prisma.TransactionClient, empresaId: string) {
  const conv = await tx.convenio.create({ data: { empresaId, ...CONVENIO_COMERCIO } });
  await tx.categoria.createMany({ data: CATEGORIAS_COMERCIO.map((nombre, i) => ({ empresaId, convenioId: conv.id, nombre, orden: i + 1 })) });
  await tx.concepto.createMany({ data: CONCEPTOS_COMERCIO.map((c) => ({ empresaId, codigo: c.codigo, nombre: c.nombre, clase: c.clase, tipo: c.tipo, parametros: c.parametros as Prisma.InputJsonValue, orden: Number(c.codigo), soloAfiliados: !!c.soloAfiliados })) });
}
