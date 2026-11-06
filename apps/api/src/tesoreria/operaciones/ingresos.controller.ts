import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosIngreso, esquemaAnular, esquemaIngreso } from './dto';
import { IngresosService } from './ingresos.service';

@Controller('tesoreria/ingresos')
export class IngresosController {
  constructor(private readonly ingresos: IngresosService) {}

  @Get() @RequierePermiso('tesoreria.ver')
  listar(@Query() q: { pagina?: string; porPagina?: string; estado?: string }) {
    return this.ingresos.listar(q);
  }

  @Get(':id') @RequierePermiso('tesoreria.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingresos.obtener(id);
  }

  @Post() @RequierePermiso('tesoreria.operar')
  crear(@Body(new ZodValidationPipe(esquemaIngreso)) d: DatosIngreso) {
    return this.ingresos.crear(d);
  }

  @Post(':id/anular') @HttpCode(200) @RequierePermiso('tesoreria.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnular)) d: z.infer<typeof esquemaAnular>) {
    return this.ingresos.anular(id, d.motivo);
  }
}
