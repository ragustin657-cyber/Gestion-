import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parsearCsvIndices } from './csv';

const vista = (i: { anio: number; mes: number; valor: { toString(): string }; actualizadoEn: Date }) =>
  ({ anio: i.anio, mes: i.mes, valor: i.valor.toString(), actualizadoEn: i.actualizadoEn });

@Injectable()
export class IndicesInflacionService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    return (await this.prisma.indiceInflacion.findMany({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }] })).map(vista);
  }

  async guardar(anio: number, mes: number, valor: number, usuario: string) {
    const i = await this.prisma.indiceInflacion.upsert({
      where: { anio_mes: { anio, mes } }, create: { anio, mes, valor, actualizadoPor: usuario }, update: { valor, actualizadoPor: usuario },
    });
    return vista(i);
  }

  async borrar(anio: number, mes: number) {
    const r = await this.prisma.indiceInflacion.deleteMany({ where: { anio, mes } });
    if (!r.count) throw new NotFoundException('Índice no encontrado');
    return { ok: true };
  }

  /** Importa un CSV completo, todo o nada. */
  async importar(archivo: Buffer | undefined, usuario: string) {
    const filas = parsearCsvIndices(archivo?.toString('utf8') ?? '');
    if (!filas.length) throw new BadRequestException('El archivo no tiene índices');
    return this.prisma.$transaction(async (tx) => {
      const existentes = await tx.indiceInflacion.findMany({ where: { OR: filas.map((f) => ({ anio: f.anio, mes: f.mes })) } });
      const ya = new Set(existentes.map((e) => `${e.anio}-${e.mes}`));
      for (const f of filas)
        await tx.indiceInflacion.upsert({
          where: { anio_mes: { anio: f.anio, mes: f.mes } },
          create: { ...f, actualizadoPor: usuario }, update: { valor: f.valor, actualizadoPor: usuario },
        });
      const actualizados = filas.filter((f) => ya.has(`${f.anio}-${f.mes}`)).length;
      return { creados: filas.length - actualizados, actualizados };
    });
  }
}
