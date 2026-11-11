import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { zFecha } from '../../compras/comun';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { AjusteInflacionService } from './ajuste-inflacion.service';
import { ConfigAjusteService } from './config.service';
import { DatosConfig, esquemaConfig } from './dto';

@Controller('contabilidad/ajuste-inflacion')
export class AjusteInflacionController {
  constructor(
    private readonly config: ConfigAjusteService,
    private readonly ajustes: AjusteInflacionService,
  ) {}

  @Get('previa')
  @RequierePermiso('contabilidad.cerrar')
  async previa(@Query('fecha') fecha: string | undefined, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const f = fechaQuery(fecha, true)!;
    if (!formato) return this.ajustes.previa(f);
    if (formato !== 'xlsx') throw new BadRequestException('Formato inválido: use xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ajuste-inflacion-${fecha}.xlsx"`);
    return new StreamableFile(await this.ajustes.previaXlsx(f));
  }

  @Get()
  @RequierePermiso('plancuentas.ver')
  listar() {
    return this.ajustes.listar();
  }

  @Post()
  @RequierePermiso('contabilidad.cerrar')
  generar(@Body(new ZodValidationPipe(z.object({ fecha: zFecha }))) d: { fecha: Date }) {
    return this.ajustes.generar(d.fecha);
  }

  @Post(':id/anular')
  @RequierePermiso('contabilidad.cerrar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ motivo: z.string().trim().min(1, 'Indique el motivo') }))) d: { motivo: string }) {
    return this.ajustes.anular(id, d.motivo);
  }

  @Get('config')
  @RequierePermiso('plancuentas.ver')
  obtenerConfig() {
    return this.config.vista();
  }

  @Put('config')
  @RequierePermiso('contabilidad.cerrar')
  guardarConfig(@Body(new ZodValidationPipe(esquemaConfig)) d: DatosConfig) {
    return this.config.guardar(d);
  }
}
