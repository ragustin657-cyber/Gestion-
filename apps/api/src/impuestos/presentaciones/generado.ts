import type { ConfigImpuestos, Empresa } from '@prisma/client';
import JSZip from 'jszip';
import type { TxEmpresa } from '../../prisma/tenant-prisma.service';
import type { Dec } from '../../tesoreria/operaciones/tesoreria-comun';

/** Resultado de un generador: el archivo a entregar y lo que se compara para detectar cambios. */
export interface Generado {
  nombreArchivo: string;
  contenido: Buffer;
  registros: number;
  total: Dec;
  /** Contenido que define la huella: el TXT interno en ARBA, el archivo completo en el resto. */
  huellaDe: Buffer;
  advertencias: string[];
}

export interface ContextoGeneracion {
  empresa: Empresa;
  config: ConfigImpuestos;
  periodo: string;
  quincena: number;
  desde: Date;
  hasta: Date;
  /** Al recalcular para el historial: el nombre guardado (ARBA reusa su número de lote). */
  nombreGuardado?: string;
  /** Próximo número de lote de ARBA (solo al generar, no al recalcular). */
  siguienteLote?: () => Promise<number>;
}

export type Generador = (tx: TxEmpresa, ctx: ContextoGeneracion) => Promise<Generado>;

/** ZIP determinista (fecha fija), para que el mismo contenido dé la misma huella. */
export async function zip(archivos: Record<string, Buffer>): Promise<Buffer> {
  const z = new JSZip();
  for (const [nombre, b] of Object.entries(archivos)) z.file(nombre, b, { date: new Date('2000-01-01T00:00:00Z') });
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const mmaaaa = (periodo: string) => `${periodo.slice(4, 6)}/${periodo.slice(0, 4)}`;
