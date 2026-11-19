import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { F1359Service } from './f1359.service';

const txt = (res: Response, a: { nombre: string; contenido: Buffer }) => {
  res.set({ 'Content-Type': 'text/plain; charset=windows-1252', 'Content-Disposition': `attachment; filename="${a.nombre}"` });
  return new StreamableFile(a.contenido);
};
const pdf = (res: Response, nombre: string, contenido: Buffer) => {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}"` });
  return new StreamableFile(contenido);
};

/** F.1359 y certificados de Ganancias de cuarta (spec E32 §6 a §8). */
@Controller('sueldos')
export class F1359Controller {
  constructor(private readonly f: F1359Service) {}

  @Get('ganancias/f1359/anual/:anio') @RequierePermiso('sueldos.liquidar')
  async anual(@Param('anio', ParseIntPipe) anio: number, @Res({ passthrough: true }) res: Response) { return txt(res, await this.f.anual(anio)); }

  @Get('ganancias/f1359/final/:anio/:mes') @RequierePermiso('sueldos.liquidar')
  async final(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number, @Res({ passthrough: true }) res: Response) { return txt(res, await this.f.final(anio, mes)); }

  @Get('ganancias/f1359/distracto/:anio') @RequierePermiso('sueldos.liquidar')
  async distracto(@Param('anio', ParseIntPipe) anio: number, @Res({ passthrough: true }) res: Response) { return txt(res, await this.f.distracto(anio)); }

  @Get('ganancias/anual/:anio/certificados.pdf') @RequierePermiso('sueldos.ver')
  async certificados(@Param('anio', ParseIntPipe) anio: number, @Res({ passthrough: true }) res: Response) { return pdf(res, `certificados-ganancias-${anio}.pdf`, await this.f.certificadosAnual(anio)); }

  @Get('liquidaciones/:id/ganancias-certificado.pdf') @RequierePermiso('sueldos.ver')
  async certificadoFinal(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) { return pdf(res, 'certificado-ganancias.pdf', await this.f.certificadoFinal(id)); }
}
