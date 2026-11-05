import type { Prisma } from '@prisma/client';

/** Regímenes de Ganancias (RG 830) precargados. VALORES A VERIFICAR por el contador antes de operar. */
export const REGIMENES_INICIALES = [
  { codigo: '78', descripcion: 'Enajenación de bienes de cambio', minimoNoSujeto: 224000, alicuotaInscripto: 2, alicuotaNoInscripto: 10, usaEscala: false, minimoRetencion: 240 },
  { codigo: '94', descripcion: 'Locaciones de obra y servicios', minimoNoSujeto: 67170, alicuotaInscripto: 2, alicuotaNoInscripto: 28, usaEscala: false, minimoRetencion: 240 },
  { codigo: '110', descripcion: 'Alquileres de inmuebles urbanos', minimoNoSujeto: 11200, alicuotaInscripto: 6, alicuotaNoInscripto: 28, usaEscala: false, minimoRetencion: 240 },
  { codigo: '116', descripcion: 'Honorarios profesionales', minimoNoSujeto: 67170, alicuotaInscripto: 0, alicuotaNoInscripto: 28, usaEscala: true, minimoRetencion: 240 },
];

/** Escala de Ganancias para honorarios. VALORES A VERIFICAR. */
export const ESCALA_INICIAL = [
  { desde: 0, hasta: 8000, fijo: 0, porcentaje: 5 },
  { desde: 8000, hasta: 16000, fijo: 400, porcentaje: 9 },
  { desde: 16000, hasta: 24000, fijo: 1120, porcentaje: 12 },
  { desde: 24000, hasta: 32000, fijo: 2080, porcentaje: 15 },
  { desde: 32000, hasta: 48000, fijo: 3280, porcentaje: 19 },
  { desde: 48000, hasta: 64000, fijo: 6320, porcentaje: 23 },
  { desde: 64000, hasta: 96000, fijo: 10000, porcentaje: 27 },
  { desde: 96000, hasta: null, fijo: 18640, porcentaje: 31 },
];

/** Jurisdicciones de IIBB (Convenio Multilateral, códigos 901 a 924). */
export const JURISDICCIONES = Array.from({ length: 24 }, (_, i) => String(901 + i));
export const JURISDICCIONES_CON_PADRON = ['901', '902'];

/** Carga regímenes, escala y jurisdicciones en una empresa nueva. */
export async function cargarConfigPagos(tx: Prisma.TransactionClient, empresaId: string): Promise<void> {
  await tx.regimenGanancias.createMany({ data: REGIMENES_INICIALES.map((r) => ({ ...r, empresaId })), skipDuplicates: true });
  if (!(await tx.escalaGanancias.count({ where: { empresaId } })))
    await tx.escalaGanancias.createMany({ data: ESCALA_INICIAL.map((e) => ({ ...e, empresaId })) });
  await tx.jurisdiccionIibb.createMany({
    data: JURISDICCIONES.map((j) => {
      const padron = JURISDICCIONES_CON_PADRON.includes(j);
      return { empresaId, jurisdiccion: j, usaPadron: padron, sinPadron: padron ? 'NO_RETENER' as const : 'ALICUOTA_DEFECTO' as const };
    }),
    skipDuplicates: true,
  });
}
