import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ConciliacionesService } from './conciliaciones.service';
import { DatosConciliacion, DatosVinculo, esquemaConciliacion, esquemaLote, esquemaMotivo, esquemaVinculo } from './dto';

@Controller('conciliacion/conciliaciones')
@RequierePermiso('conciliacion.operar')
export class ConciliacionesController {
  constructor(private readonly conciliaciones: ConciliacionesService) {}

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
