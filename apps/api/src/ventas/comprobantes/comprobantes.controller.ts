import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { EmisionService } from '../emision/emision.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ComprobantesVentaService } from './comprobantes.service';
import { DatosComprobanteVenta, esquemaComprobanteVenta, esquemaModificacionVenta } from './dto';

@Controller('ventas/comprobantes')
export class ComprobantesVentaController {
  constructor(
    private readonly comprobantes: ComprobantesVentaService,
    private readonly emision: EmisionService,
  ) {}

  /** Con `emitir: true` pide el CAE a continuación; si ARCA falla, el comprobante queda guardado y se informa el error. */
  @Post() @RequierePermiso('venta.emitir')
  async crear(@Body(new ZodValidationPipe(esquemaComprobanteVenta)) d: DatosComprobanteVenta) {
    const c = await this.comprobantes.crear(d);
    return d.emitir ? this.emision.emitir(c.id) : c;
  }

  @Post(':id/emitir') @RequierePermiso('venta.emitir')
  emitir(@Param('id', ParseUUIDPipe) id: string) {
    return this.emision.emitir(id);
  }

  @Put(':id') @RequierePermiso('venta.emitir')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacionVenta)) d: DatosComprobanteVenta & { version: number }) {
    return this.comprobantes.modificar(id, d.version, d);
  }

  @Get(':id/pdf') @RequierePermiso('venta.ver')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.comprobantes.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }

  @Delete(':id') @RequierePermiso('venta.emitir')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.comprobantes.eliminar(id);
  }
}
