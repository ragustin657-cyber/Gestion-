import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ComprobantesService, FiltroComprobantes } from './comprobantes.service';
import { DatosComprobante, esquemaComprobante } from './dto';

@Controller('compras/comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Get()
  @RequierePermiso('fc.ver')
  listar(@Query() f: FiltroComprobantes) {
    return this.comprobantes.listar(f);
  }

  @Get(':id')
  @RequierePermiso('fc.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.comprobantes.obtener(id);
  }

  @Post()
  @RequierePermiso('fc.crear')
  crear(@Body(new ZodValidationPipe(esquemaComprobante)) d: DatosComprobante) {
    return this.comprobantes.crear(d);
  }
}
