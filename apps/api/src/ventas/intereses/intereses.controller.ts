import { Body, Controller, Get, Put } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigInteresesService } from './config.service';
import { DatosConfigIntereses, esquemaConfigIntereses } from './dto';

@Controller('ventas/intereses')
@RequierePermiso('intereses.liquidar')
export class InteresesController {
  constructor(private readonly config: ConfigInteresesService) {}

  @Get('configuracion')
  verConfiguracion() { return this.config.ver(); }

  @Put('configuracion')
  guardarConfiguracion(@Body(new ZodValidationPipe(esquemaConfigIntereses)) d: DatosConfigIntereses) { return this.config.guardar(d); }
}
