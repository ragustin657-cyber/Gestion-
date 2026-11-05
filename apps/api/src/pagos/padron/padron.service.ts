import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilaPadron, parsearLineaAgip, parsearLineaArba } from './parsers';

export const JURISDICCIONES_PADRON = { '901': parsearLineaAgip, '902': parsearLineaArba } as const;
export type JurisdiccionPadron = keyof typeof JURISDICCIONES_PADRON;
const LOTE = 5000;

/** Padrones de IIBB (globales). El procesamiento corre en segundo plano. */
@Injectable()
export class PadronService {
  private readonly log = new Logger(PadronService.name);
  constructor(private readonly prisma: PrismaService) {}

  async cargar(jurisdiccion: string, nombreArchivo: string, contenido: Buffer, usuarioId: string): Promise<{ id: string }> {
    if (!(jurisdiccion in JURISDICCIONES_PADRON)) throw new BadRequestException('Solo se pueden cargar padrones de CABA (901) y Buenos Aires (902)');
    const carga = await this.prisma.padronCarga.create({ data: { jurisdiccion, archivo: nombreArchivo, creadoPor: usuarioId } });
    setImmediate(() => void this.procesar(carga.id, jurisdiccion as JurisdiccionPadron, contenido));
    return { id: carga.id };
  }

  /** Lee el archivo, fusiona filas por CUIT y reemplaza el período en una transacción. */
  async procesar(id: string, jurisdiccion: JurisdiccionPadron, contenido: Buffer): Promise<void> {
    try {
      const parsear = JURISDICCIONES_PADRON[jurisdiccion];
      const porCuit = new Map<string, FilaPadron>();
      const lineas = contenido.toString('latin1').split('\n');
      lineas.forEach((l, i) => {
        const f = parsear(l, i + 1);
        if (!f) return;
        const previa = porCuit.get(f.cuit);
        porCuit.set(f.cuit, previa
          ? { ...previa, alicuotaRetencion: f.alicuotaRetencion ?? previa.alicuotaRetencion, alicuotaPercepcion: f.alicuotaPercepcion ?? previa.alicuotaPercepcion }
          : f);
      });
      const filas = [...porCuit.values()];
      if (!filas.length) throw new Error('El archivo no tiene filas');
      const desde = filas[0].vigenciaDesde;
      await this.prisma.$transaction(async (tx) => {
        await tx.padronIibb.deleteMany({ where: { jurisdiccion, vigenciaDesde: desde } });
        for (let i = 0; i < filas.length; i += LOTE)
          await tx.padronIibb.createMany({ data: filas.slice(i, i + LOTE).map((f) => ({ ...f, jurisdiccion })) });
      }, { timeout: 15 * 60 * 1000 });
      await this.prisma.padronCarga.update({
        where: { id },
        data: { estado: 'COMPLETA', filas: filas.length, periodo: desde.toISOString().slice(0, 7) },
      });
    } catch (e) {
      this.log.warn(`Carga de padrón ${id} con error: ${(e as Error).message}`);
      await this.prisma.padronCarga.update({ where: { id }, data: { estado: 'ERROR', error: (e as Error).message } }).catch(() => undefined);
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
