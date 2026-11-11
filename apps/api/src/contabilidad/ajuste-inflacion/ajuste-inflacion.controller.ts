import { Body, Controller, Get, Put } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigAjusteService } from './config.service';
import { DatosConfig, esquemaConfig } from './dto';

@Controller('contabilidad/ajuste-inflacion')
export class AjusteInflacionController {
  constructor(private readonly config: ConfigAjusteService) {}

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
