import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { esquemaGenerar, esquemaVistaPrevia, type DatosGenerar, type FiltroVistaPrevia } from './dto';
import { LotesFacturacionService } from './lotes.service';

/** E55: facturación por lotes de los remitos pendientes. */
@Controller('ventas/facturacion-lotes')
export class LotesFacturacionController {
  constructor(private readonly lotes: LotesFacturacionService) {}

  @Get('vista-previa')
  @RequierePermiso('venta.emitir')
  vistaPrevia(@Query(new ZodValidationPipe(esquemaVistaPrevia)) q: FiltroVistaPrevia) {
    return this.lotes.vistaPrevia(q);
  }

  @Post()
  @RequierePermiso('venta.emitir')
  generar(@Body(new ZodValidationPipe(esquemaGenerar)) d: DatosGenerar) {
    return this.lotes.generar(d);
  }

  @Get()
  @RequierePermiso('venta.ver')
  listar() {
    return this.lotes.listar();
  }

  @Get(':id')
  @RequierePermiso('venta.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotes.obtener(id);
  }

  @Get(':id/pdf')
  @RequierePermiso('venta.ver')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.lotes.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }
}
