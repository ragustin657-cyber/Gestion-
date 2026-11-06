import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ImportacionesService } from './importaciones.service';

const subida = FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } });
const esquema = z.object({ cuentaBancariaId: z.string().uuid('Cuenta bancaria inválida') });
type Archivo = { buffer: Buffer; originalname: string };

@Controller('conciliacion/importaciones')
@RequierePermiso('conciliacion.operar')
export class ImportacionesController {
  constructor(private readonly importaciones: ImportacionesService) {}

  @Get()
  listar(@Query('cuentaBancariaId') cuentaBancariaId?: string) {
    return this.importaciones.listar(cuentaBancariaId);
  }

  @Post('previsualizar') @HttpCode(200) @UseInterceptors(subida)
  previsualizar(@Body(new ZodValidationPipe(esquema)) b: z.infer<typeof esquema>, @UploadedFile() archivo?: Archivo) {
    return this.importaciones.previsualizar(b.cuentaBancariaId, archivo?.buffer);
  }

  @Post() @UseInterceptors(subida)
  importar(@Body(new ZodValidationPipe(esquema)) b: z.infer<typeof esquema>, @UploadedFile() archivo?: Archivo) {
    return this.importaciones.importar(b.cuentaBancariaId, archivo?.buffer, archivo?.originalname ?? 'extracto');
  }

  @Post(':id/deshacer') @HttpCode(200)
  deshacer(@Param('id', ParseUUIDPipe) id: string) {
    return this.importaciones.deshacer(id);
  }
}
