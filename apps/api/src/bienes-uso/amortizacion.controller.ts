import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { AmortizacionService } from './amortizacion.service';

@Controller('bienes-uso/amortizacion')
@RequierePermiso('contabilidad.cerrar')
export class AmortizacionController {
  constructor(private readonly amortizacion: AmortizacionService) {}

  @Get()
  listar() {
    return this.amortizacion.listar();
  }

  @Get('previa')
  previa(@Query('mes') mes?: string) {
    return this.amortizacion.previa(mes);
  }

  @Post()
  generar(@Body() d: { mes?: string }) {
    return this.amortizacion.generar(d?.mes);
  }

  @Post(':id/anular')
  @HttpCode(201)
  anular(@Param('id', ParseUUIDPipe) id: string) {
    return this.amortizacion.anular(id);
  }
}
