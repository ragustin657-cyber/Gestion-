import { Body, Controller, Get, Put, Query } from '@nestjs/common';
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
  previa(@Query('fecha') fecha?: string) {
    return this.ajustes.previa(fechaQuery(fecha, true)!);
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
