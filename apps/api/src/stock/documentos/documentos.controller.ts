import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DocumentosStockService } from './documentos.service';
import { DatosDocumento, esquemaAnulacion, esquemaDocumento } from './dto';

@Controller('stock/documentos')
export class DocumentosStockController {
  constructor(private readonly documentos: DocumentosStockService) {}

  @Get()
  @RequierePermiso('stock.ver')
  listar(@Query() q: { tipo?: string; desde?: string; hasta?: string }) {
    return this.documentos.listar(q);
  }

  @Get(':id')
  @RequierePermiso('stock.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentos.obtener(id);
  }

  @Post()
  @RequierePermiso('stock.operar')
  crear(@Body(new ZodValidationPipe(esquemaDocumento)) d: DatosDocumento) {
    return this.documentos.crear(d);
  }

  @Post(':id/anular')
  @RequierePermiso('stock.operar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnulacion)) d: { motivo: string }) {
    return this.documentos.anular(id, d.motivo);
  }
}
