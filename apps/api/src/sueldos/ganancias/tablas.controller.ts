import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { RequiereAlguno, RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosTablaGanancias, esquemaTablaGanancias } from './dto';
import { TablasGananciasService } from './tablas.service';

/** Tablas de ARCA de Ganancias de cuarta categoría (spec E31 §3). */
@Controller('sueldos/ganancias/tablas')
export class TablasGananciasController {
  constructor(private readonly t: TablasGananciasService) {}

  @Get(':anio/:semestre') @RequiereAlguno('ganancias.configurar', 'sueldos.ver')
  ver(@Param('anio', ParseIntPipe) anio: number, @Param('semestre', ParseIntPipe) semestre: number) { return this.t.ver(anio, semestre); }

  @Put(':anio/:semestre') @RequierePermiso('ganancias.configurar')
  guardar(@Param('anio', ParseIntPipe) anio: number, @Param('semestre', ParseIntPipe) semestre: number, @Body(new ZodValidationPipe(esquemaTablaGanancias)) d: DatosTablaGanancias) {
    return this.t.guardar(anio, semestre, d);
  }

  @Post(':anio/:semestre/copiar-anterior') @RequierePermiso('ganancias.configurar')
  copiar(@Param('anio', ParseIntPipe) anio: number, @Param('semestre', ParseIntPipe) semestre: number) { return this.t.copiarAnterior(anio, semestre); }
}
