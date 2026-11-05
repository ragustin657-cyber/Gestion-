import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosIR, esquemaAnular, esquemaIR } from './dto';
import { RecepcionesService } from './recepciones.service';

@Controller('compras/recepciones')
export class RecepcionesController {
  constructor(private readonly recepciones: RecepcionesService) {}

  @Get()
  @RequierePermiso('ir.ver')
  listar(@Query() f: { terceroId?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    return this.recepciones.listar(f);
  }

  @Get('pendientes-facturar')
  @RequierePermiso('fc.crear')
  pendientes(@Query('terceroId') terceroId?: string) {
    return this.recepciones.pendientesFacturar(terceroId);
  }

  @Get(':id')
  @RequierePermiso('ir.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.recepciones.obtener(id);
  }

  @Post()
  @RequierePermiso('ir.crear')
  crear(@Body(new ZodValidationPipe(esquemaIR)) d: DatosIR) {
    return this.recepciones.crear(d);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermiso('ir.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnular)) b: { motivo: string }) {
    return this.recepciones.anular(id, b.motivo);
  }
}
