import { Body, Controller, Get, HttpCode, Post, Put, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AmbienteArca } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ConfigArcaService } from './config-arca.service';

const esquema = z.object({ ambiente: z.nativeEnum(AmbienteArca) });
type Archivos = { certificado?: { buffer: Buffer }[]; clave?: { buffer: Buffer }[] };
const subida = FileFieldsInterceptor([{ name: 'certificado', maxCount: 1 }, { name: 'clave', maxCount: 1 }], { limits: { fileSize: 64 * 1024 } });

@Controller('arca')
@RequierePermiso('arca.configurar')
export class ConfigArcaController {
  constructor(private readonly config: ConfigArcaService) {}

  @Get('config')
  obtener() {
    return this.config.obtener();
  }

  @Put('config')
  guardar(@Body(new ZodValidationPipe(esquema)) d: z.infer<typeof esquema>) {
    return this.config.guardar(d);
  }

  @Post('certificado') @UseInterceptors(subida)
  certificado(@UploadedFiles() a: Archivos) {
    return this.config.cargarCertificado(a?.certificado?.[0]?.buffer.toString('utf8'), a?.clave?.[0]?.buffer.toString('utf8'));
  }

  @Post('probar') @HttpCode(200)
  probar() {
    return this.config.probar();
  }
}
