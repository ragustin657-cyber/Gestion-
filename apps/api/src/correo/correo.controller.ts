import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ConfigCorreoService } from './config-correo.service';
import { DatosConfigCorreo, esquemaConfigCorreo, esquemaPrueba } from './dto';

@Controller('correo')
@RequierePermiso('correo.configurar')
export class CorreoController {
  constructor(private readonly config: ConfigCorreoService) {}

  @Get('configuracion')
  ver() { return this.config.ver(); }

  @Put('configuracion')
  guardar(@Body(new ZodValidationPipe(esquemaConfigCorreo)) d: DatosConfigCorreo) { return this.config.guardar(d); }

  @Post('prueba')
  prueba(@Body(new ZodValidationPipe(esquemaPrueba)) d: { destinatario: string }) { return this.config.prueba(d.destinatario); }
}
