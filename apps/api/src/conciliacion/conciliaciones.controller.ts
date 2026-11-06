import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { reportePdf, reporteXlsx } from './reporte';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ConciliacionesService } from './conciliaciones.service';
import { RegistroService } from './registro.service';
import { DatosConciliacion, DatosRegistro, DatosVinculo, esquemaConciliacion, esquemaLote, esquemaMotivo, esquemaRegistro, esquemaVinculo } from './dto';

@Controller('conciliacion/conciliaciones')
@RequierePermiso('conciliacion.operar')
export class ConciliacionesController {
  constructor(
    private readonly conciliaciones: ConciliacionesService,
    private readonly registro: RegistroService,
  ) {}

  @Get(':id/reporte')
  async reporte(@Param('id', ParseUUIDPipe) id: string, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!['pdf', 'xlsx', 'json'].includes(formato ?? '')) throw new BadRequestException('Formato inválido: use pdf, xlsx o json');
    const d = await this.conciliaciones.datosReporte(id);
    if (formato === 'json') return d;
    const c = await this.conciliaciones.obtenerCabecera(id);
    const nombre = `conciliacion-${c.cuentaNumero}-${c.desde}.${formato}`.replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    return new StreamableFile(formato === 'pdf' ? await reportePdf(d) : await reporteXlsx(d));
  }

  @Post(':id/cerrar') @HttpCode(200)
  cerrar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ version: z.number().int().min(0) }))) d: { version: number }) {
    return this.conciliaciones.cerrar(id, d.version);
  }

  @Post(':id/reabrir') @HttpCode(200) @RequierePermiso('tesoreria.anular')
  reabrir(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaMotivo)) d: z.infer<typeof esquemaMotivo>) {
    return this.conciliaciones.reabrir(id, d.motivo);
  }

  @Post(':id/registrar')
  registrar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegistro)) d: DatosRegistro) {
    return this.registro.registrar(id, d);
  }

  @Get()
  listar(@Query('cuentaBancariaId') cuentaBancariaId?: string) {
    return this.conciliaciones.listar(cuentaBancariaId);
  }

  @Post()
  crear(@Body(new ZodValidationPipe(esquemaConciliacion)) d: DatosConciliacion) {
    return this.conciliaciones.crear(d);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.conciliaciones.obtener(id);
  }

  @Post(':id/sugerencias') @HttpCode(200)
  sugerencias(@Param('id', ParseUUIDPipe) id: string) {
    return this.conciliaciones.sugerencias(id);
  }

  @Post(':id/vinculos')
  vincular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaVinculo)) d: DatosVinculo) {
    return this.conciliaciones.crearVinculo(id, d.lineas, d.movimientos);
  }

  @Post(':id/vinculos/lote')
  lote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaLote)) d: z.infer<typeof esquemaLote>) {
    return this.conciliaciones.crearLote(id, d.vinculos);
  }

  @Delete(':id/vinculos/:vinculoId')
  desvincular(@Param('id', ParseUUIDPipe) id: string, @Param('vinculoId', ParseUUIDPipe) vinculoId: string) {
    return this.conciliaciones.eliminarVinculo(id, vinculoId);
  }

  @Post(':id/lineas/:lineaId/ignorar') @HttpCode(200)
  ignorar(@Param('id', ParseUUIDPipe) id: string, @Param('lineaId', ParseUUIDPipe) lineaId: string, @Body(new ZodValidationPipe(esquemaMotivo)) d: z.infer<typeof esquemaMotivo>) {
    return this.conciliaciones.ignorar(id, lineaId, d.motivo);
  }

  @Post(':id/lineas/:lineaId/restaurar') @HttpCode(200)
  restaurar(@Param('id', ParseUUIDPipe) id: string, @Param('lineaId', ParseUUIDPipe) lineaId: string) {
    return this.conciliaciones.ignorar(id, lineaId, null);
  }
}
