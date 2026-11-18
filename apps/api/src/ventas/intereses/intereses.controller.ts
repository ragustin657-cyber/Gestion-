import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { InteresesCalculoService } from './calculo.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigInteresesService } from './config.service';
import { DatosConfigIntereses, esquemaConfigIntereses } from './dto';

@Controller('ventas/intereses')
@RequierePermiso('intereses.liquidar')
export class InteresesController {
  constructor(private readonly config: ConfigInteresesService, private readonly calculo: InteresesCalculoService) {}

  @Get()
  consulta(@Query('anio') anio: string, @Query('mes') mes: string) { return this.calculo.consulta(Number(anio), Number(mes)); }

  @Get('configuracion')
  verConfiguracion() { return this.config.ver(); }

  @Put('configuracion')
  guardarConfiguracion(@Body(new ZodValidationPipe(esquemaConfigIntereses)) d: DatosConfigIntereses) { return this.config.guardar(d); }
}
