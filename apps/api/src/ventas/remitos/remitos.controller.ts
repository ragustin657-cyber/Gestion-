import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosRemito, esquemaAnulacionRemito, esquemaRemito } from './dto';
import { RemitosService } from './remitos.service';

@Controller('ventas/remitos')
export class RemitosController {
  constructor(private readonly remitos: RemitosService) {}

  @Get() @RequierePermiso('venta.ver')
  listar(@Query() q: { terceroId?: string; pendientes?: string }) {
    return this.remitos.listar(q);
  }

  @Get('pendientes-facturar') @RequierePermiso('venta.ver')
  pendientes(@Query('terceroId') terceroId?: string) {
    return this.remitos.pendientesFacturar(terceroId);
  }

  @Get(':id') @RequierePermiso('venta.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.remitos.obtener(id);
  }

  @Get(':id/pdf') @RequierePermiso('venta.ver')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.remitos.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }

  @Post() @RequierePermiso('pedido.gestionar')
  crear(@Body(new ZodValidationPipe(esquemaRemito)) d: DatosRemito) {
    return this.remitos.crear(d);
  }

  @Post(':id/anular') @RequierePermiso('pedido.gestionar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnulacionRemito)) d: { motivo: string }) {
    return this.remitos.anular(id, d.motivo);
  }
}
