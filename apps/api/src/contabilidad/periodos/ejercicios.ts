import type { Prisma } from '@prisma/client';

/** Ejercicio de 12 meses que contiene la fecha, según el mes de inicio (1 a 12). */
export function rangoEjercicio(inicioMes: number, fecha: Date): { desde: Date; hasta: Date } {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const anioInicio = mes >= inicioMes ? anio : anio - 1;
  const desde = new Date(Date.UTC(anioInicio, inicioMes - 1, 1));
  const hasta = new Date(Date.UTC(anioInicio + 1, inicioMes - 1, 0));
  return { desde, hasta };
}

/** Los 12 meses de un ejercicio que empieza en `desde` (día 1). */
export function mesesDe(desde: Date): { anio: number; mes: number; desde: Date; hasta: Date }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const inicio = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + i, 1));
    return {
      anio: inicio.getUTCFullYear(), mes: inicio.getUTCMonth() + 1, desde: inicio,
      hasta: new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0)),
    };
  });
}

/** Crea un ejercicio con sus 12 períodos abiertos (sin filtro de empresa: recibe el empresaId). */
export async function crearEjercicio(tx: Prisma.TransactionClient, empresaId: string, desde: Date, numero: number) {
  const meses = mesesDe(desde);
  const ejercicio = await tx.ejercicio.create({ data: { empresaId, numero, desde, hasta: meses[11].hasta } });
  await tx.periodoContable.createMany({ data: meses.map((m) => ({ empresaId, ejercicioId: ejercicio.id, ...m })) });
  return ejercicio;
}
