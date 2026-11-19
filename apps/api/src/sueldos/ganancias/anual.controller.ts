import { Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { AnualGananciasService } from './anual.service';

/** Liquidación anual de Ganancias de cuarta (spec E32 §5). */
@Controller('sueldos/ganancias/anual')
export class AnualGananciasController {
  constructor(private readonly a: AnualGananciasService) {}

  @Get(':anio') @RequierePermiso('sueldos.ver')
  ver(@Param('anio', ParseIntPipe) anio: number) { return this.a.ver(anio); }

  @Post(':anio/calcular') @RequierePermiso('sueldos.liquidar')
  calcular(@Param('anio', ParseIntPipe) anio: number) { return this.a.calcular(anio); }

  @Post(':anio/cerrar') @RequierePermiso('sueldos.liquidar')
  cerrar(@Param('anio', ParseIntPipe) anio: number) { return this.a.cerrar(anio); }

  @Post(':anio/reabrir') @RequierePermiso('sueldos.liquidar')
  reabrir(@Param('anio', ParseIntPipe) anio: number) { return this.a.reabrir(anio); }
}
