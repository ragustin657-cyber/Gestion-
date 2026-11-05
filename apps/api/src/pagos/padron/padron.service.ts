import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { FilaPadron, parsearLineaAgip, parsearLineaArba } from './parsers';

export const JURISDICCIONES_PADRON = { '901': parsearLineaAgip, '902': parsearLineaArba } as const;
export type JurisdiccionPadron = keyof typeof JURISDICCIONES_PADRON;
const LOTE = 5000;

/**
 * Padrones de IIBB (globales, cargados por el administrador general).
 * El archivo se lee por líneas (sin cargarlo entero en memoria) y se fusiona por CUIT y vigencia:
 * cargar el archivo de percepciones no borra las alícuotas de retención del mismo período, y viceversa.
 */
@Injectable()
export class PadronService implements OnModuleInit {
  private readonly log = new Logger(PadronService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Al arrancar, las cargas que quedaron "procesando" (reinicio o caída) pasan a error. */
  async onModuleInit(): Promise<void> {
    await this.prisma.padronCarga.updateMany({
      where: { estado: 'PROCESANDO' },
      data: { estado: 'ERROR', error: 'Proceso interrumpido por un reinicio del servidor: vuelva a cargar el archivo' },
    });
  }

  async cargar(jurisdiccion: string, nombreArchivo: string, origen: string | Buffer, usuarioId: string): Promise<{ id: string }> {
    if (!(jurisdiccion in JURISDICCIONES_PADRON)) throw new BadRequestException('Solo se pueden cargar padrones de CABA (901) y Buenos Aires (902)');
    if (await this.prisma.padronCarga.findFirst({ where: { jurisdiccion, estado: 'PROCESANDO' } }))
      throw new ConflictException('Ya hay un padrón de esa jurisdicción en proceso');
    const carga = await this.prisma.padronCarga.create({ data: { jurisdiccion, archivo: nombreArchivo, creadoPor: usuarioId } });
    setImmediate(() => void this.procesar(carga.id, jurisdiccion as JurisdiccionPadron, origen));
    return { id: carga.id };
  }

  /** Procesa un archivo (ruta en disco o contenido) en una transacción: si falla, el padrón vigente no cambia. */
  async procesar(id: string, jurisdiccion: JurisdiccionPadron, origen: string | Buffer): Promise<void> {
    try {
      const parsear = JURISDICCIONES_PADRON[jurisdiccion];
      const vigencias = new Set<string>();
      let periodo: string | null = null;
      await this.prisma.$transaction(async (tx) => {
        const limpiados = new Set<string>();
        let lote = new Map<string, FilaPadron>();
        const volcar = async () => {
          if (!lote.size) return;
          const filas = [...lote.values()];
          lote = new Map();
          await tx.$executeRawUnsafe(
            `INSERT INTO "PadronIibb" ("id","jurisdiccion","cuit","vigenciaDesde","vigenciaHasta","alicuotaRetencion","alicuotaPercepcion")
             SELECT gen_random_uuid(), $1, c, d::date, h::date, r::numeric, p::numeric
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS t(c, d, h, r, p)
             ON CONFLICT ("jurisdiccion","cuit","vigenciaDesde") DO UPDATE SET
               "vigenciaHasta" = EXCLUDED."vigenciaHasta",
               "alicuotaRetencion" = COALESCE(EXCLUDED."alicuotaRetencion", "PadronIibb"."alicuotaRetencion"),
               "alicuotaPercepcion" = COALESCE(EXCLUDED."alicuotaPercepcion", "PadronIibb"."alicuotaPercepcion")`,
            jurisdiccion, filas.map((f) => f.cuit), filas.map((f) => f.vigenciaDesde.toISOString().slice(0, 10)), filas.map((f) => f.vigenciaHasta.toISOString().slice(0, 10)),
            filas.map((f) => f.alicuotaRetencion ?? null), filas.map((f) => f.alicuotaPercepcion ?? null),
          );
        };
        // El lector se crea recién acá: si se crea antes de la transacción, el archivo puede terminar de leerse sin consumidor
        const entrada = typeof origen === 'string' ? createReadStream(origen, { encoding: 'latin1' }) : Readable.from([origen.toString('latin1')]);
        const lineas = createInterface({ input: entrada, crlfDelay: Infinity });
        let nro = 0;
        for await (const linea of lineas) {
          const f = parsear(linea, ++nro);
          if (!f) continue;
          const desde = f.vigenciaDesde.toISOString().slice(0, 10);
          periodo ??= desde.slice(0, 7);
          vigencias.add(desde);
          // La primera vez que aparece un tipo de alícuota para una vigencia, se limpia ese tipo (reemplazo del período)
          for (const [col, valor] of [['alicuotaRetencion', f.alicuotaRetencion], ['alicuotaPercepcion', f.alicuotaPercepcion]] as const) {
            const clave = `${desde}|${col}`;
            if (valor !== null && !limpiados.has(clave)) {
              limpiados.add(clave);
              await tx.$executeRawUnsafe(`UPDATE "PadronIibb" SET "${col}" = NULL WHERE "jurisdiccion" = $1 AND "vigenciaDesde" = $2::date`, jurisdiccion, desde);
            }
          }
          const k = `${f.cuit}|${desde}`;
          const previa = lote.get(k);
          lote.set(k, previa
            ? { ...previa, alicuotaRetencion: f.alicuotaRetencion ?? previa.alicuotaRetencion, alicuotaPercepcion: f.alicuotaPercepcion ?? previa.alicuotaPercepcion }
            : f);
          if (lote.size >= LOTE) await volcar();
        }
        await volcar();
        if (!vigencias.size) throw new Error('El archivo no tiene filas');
        await tx.padronIibb.deleteMany({ where: { jurisdiccion, alicuotaRetencion: null, alicuotaPercepcion: null } });
      }, { timeout: 30 * 60 * 1000 });
      const filas = await this.prisma.padronIibb.count({ where: { jurisdiccion, vigenciaDesde: { in: [...vigencias].map((v) => new Date(`${v}T00:00:00Z`)) } } });
      await this.prisma.padronCarga.update({ where: { id }, data: { estado: 'COMPLETA', filas, periodo } });
    } catch (e) {
      this.log.warn(`Carga de padrón ${id} con error: ${(e as Error).message}`);
      await this.prisma.padronCarga.update({ where: { id }, data: { estado: 'ERROR', error: (e as Error).message } }).catch(() => undefined);
    } finally {
      if (typeof origen === 'string') await unlink(origen).catch(() => undefined);
    }
  }

  listar() {
    return this.prisma.padronCarga.findMany({ orderBy: { creadoEn: 'desc' }, take: 100 });
  }

  async obtener(id: string) {
    const c = await this.prisma.padronCarga.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Carga no encontrada');
    return c;
  }

  /** Alícuota de retención vigente a la fecha, o null si el CUIT no figura. */
  async alicuotaRetencion(jurisdiccion: string, cuit: string, fecha: Date): Promise<string | null> {
    const f = await this.prisma.padronIibb.findFirst({
      where: { jurisdiccion, cuit, vigenciaDesde: { lte: fecha }, vigenciaHasta: { gte: fecha }, alicuotaRetencion: { not: null } },
      orderBy: { vigenciaDesde: 'desc' },
    });
    return f?.alicuotaRetencion?.toString() ?? null;
  }
}
