import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { esquemaAcumulado, esquemaDatosF572, F572Service } from './f572.service';
import { DatosF572 } from './f572-xml';

const esquemaGuardar = z.object({ datos: esquemaDatosF572 });

/** F.572 web y acumulado previo de Ganancias de cuarta (spec E31 §4 y §6). */
@Controller('sueldos/ganancias')
export class F572Controller {
  constructor(private readonly f: F572Service) {}

  @Post('f572/importar') @RequierePermiso('sueldos.liquidar')
  @UseInterceptors(FilesInterceptor('archivos', 50, { limits: { fileSize: 2 * 1024 * 1024 } }))
  importar(@UploadedFiles() archivos: { originalname: string; buffer: Buffer }[] = [], @Body() body: { confirmar?: string }) {
    return this.f.importar(archivos.map((a) => ({ nombre: a.originalname, contenido: a.buffer })), body?.confirmar === 'true');
  }

  @Get('f572/:empleadoId/:anio') @RequierePermiso('sueldos.ver')
  ver(@Param('empleadoId', ParseUUIDPipe) empleadoId: string, @Param('anio', ParseIntPipe) anio: number) { return this.f.ver(empleadoId, anio); }

  @Put('f572/:empleadoId/:anio') @RequierePermiso('sueldos.liquidar')
  guardar(@Param('empleadoId', ParseUUIDPipe) empleadoId: string, @Param('anio', ParseIntPipe) anio: number, @Body(new ZodValidationPipe(esquemaGuardar)) d: z.infer<typeof esquemaGuardar>) {
    return this.f.guardar(empleadoId, anio, d.datos as DatosF572);
  }

  @Get('acumulado/:empleadoId/:anio') @RequierePermiso('sueldos.ver')
  verAcumulado(@Param('empleadoId', ParseUUIDPipe) empleadoId: string, @Param('anio', ParseIntPipe) anio: number) { return this.f.verAcumulado(empleadoId, anio); }

  @Put('acumulado/:empleadoId/:anio') @RequierePermiso('sueldos.liquidar')
  guardarAcumulado(@Param('empleadoId', ParseUUIDPipe) empleadoId: string, @Param('anio', ParseIntPipe) anio: number, @Body(new ZodValidationPipe(esquemaAcumulado)) d: z.infer<typeof esquemaAcumulado>) {
    return this.f.guardarAcumulado(empleadoId, anio, d);
  }
}
