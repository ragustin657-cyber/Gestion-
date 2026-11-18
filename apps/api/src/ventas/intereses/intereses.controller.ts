import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { LiquidacionesInteresesService } from './liquidaciones.service';
import { InteresesCalculoService } from './calculo.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigInteresesService } from './config.service';
import { DatosConfigIntereses, esquemaConfigIntereses, esquemaLiquidarIntereses } from './dto';

@Controller('ventas/intereses')
@RequierePermiso('intereses.liquidar')
export class InteresesController {
  constructor(private readonly config: ConfigInteresesService, private readonly calculo: InteresesCalculoService, private readonly liquidaciones: LiquidacionesInteresesService) {}

  @Post()
  confirmar(@Body(new ZodValidationPipe(esquemaLiquidarIntereses)) d: { anio: number; mes: number; excluir: string[] }) { return this.liquidaciones.confirmar(d.anio, d.mes, d.excluir); }

  @Get('liquidaciones')
  historial() { return this.liquidaciones.listar(); }

  @Get()
  consulta(@Query('anio') anio: string, @Query('mes') mes: string) { return this.calculo.consulta(Number(anio), Number(mes)); }

  @Get('configuracion')
  verConfiguracion() { return this.config.ver(); }

  @Put('configuracion')
  guardarConfiguracion(@Body(new ZodValidationPipe(esquemaConfigIntereses)) d: DatosConfigIntereses) { return this.config.guardar(d); }
}
