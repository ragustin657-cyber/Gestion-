import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ComprobantesVentaService } from './comprobantes.service';
import { DatosComprobanteVenta, esquemaComprobanteVenta, esquemaModificacionVenta } from './dto';

@Controller('ventas/comprobantes')
export class ComprobantesVentaController {
  constructor(private readonly comprobantes: ComprobantesVentaService) {}

  @Post() @RequierePermiso('venta.emitir')
  crear(@Body(new ZodValidationPipe(esquemaComprobanteVenta)) d: DatosComprobanteVenta) {
    return this.comprobantes.crear(d);
  }

  @Put(':id') @RequierePermiso('venta.emitir')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacionVenta)) d: DatosComprobanteVenta & { version: number }) {
    return this.comprobantes.modificar(id, d.version, d);
  }

  @Delete(':id') @RequierePermiso('venta.emitir')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.comprobantes.eliminar(id);
  }
}
