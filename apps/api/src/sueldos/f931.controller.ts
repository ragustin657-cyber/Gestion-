import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { F931Service } from './f931.service';

@Controller('sueldos')
export class F931Controller {
  constructor(private readonly f: F931Service) {}

  @Get('f931') @RequierePermiso('sueldos.ver')
  async f931(@Query('anio') anio: string, @Query('mes') mes: string, @Res({ passthrough: true }) res: Response) {
    const a = await this.f.generar(Number(anio), Number(mes));
    res.set({ 'Content-Type': 'text/plain; charset=windows-1252', 'Content-Disposition': `attachment; filename="${a.nombre}"` });
    return new StreamableFile(a.contenido);
  }
}
