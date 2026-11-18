import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { LsdService } from './lsd.service';

const descarga = (res: Response, a: { nombre: string; contenido: Buffer }) => {
  res.set({ 'Content-Type': 'text/plain; charset=windows-1252', 'Content-Disposition': `attachment; filename="${a.nombre}"` });
  return new StreamableFile(a.contenido);
};

/** Libro de Sueldos Digital (spec E30). */
@Controller('sueldos')
export class LsdController {
  constructor(private readonly lsd: LsdService) {}

  @Get('lsd/conceptos') @RequierePermiso('sueldos.ver')
  async conceptos(@Res({ passthrough: true }) res: Response) {
    return descarga(res, await this.lsd.conceptos());
  }
}
