import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zMotivo } from '../../compras/comun';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosRecibo, esquemaRecibo } from './dto';
import { RecibosService } from './recibos.service';

const esquemaAnular = z.object({ motivo: zMotivo });

@Controller('ventas/recibos')
export class RecibosController {
  constructor(private readonly recibos: RecibosService) {}

  @Post() @RequierePermiso('cobro.registrar')
  crear(@Body(new ZodValidationPipe(esquemaRecibo)) d: DatosRecibo) {
    return this.recibos.crear(d);
  }

  @Get(':id') @RequierePermiso('venta.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.recibos.obtener(id);
  }

  @Post(':id/anular') @HttpCode(200) @RequierePermiso('cobro.registrar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnular)) b: { motivo: string }) {
    return this.recibos.anular(id, b.motivo);
  }
}
