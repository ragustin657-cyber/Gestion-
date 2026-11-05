import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosRecepcion, DatosTraslado, esquemaAnular, esquemaRecepcion, esquemaTraslado } from './dto';
import { TrasladosService } from './traslados.service';

@Controller('tesoreria/traslados')
export class TrasladosController {
  constructor(private readonly traslados: TrasladosService) {}

  @Get() @RequierePermiso('tesoreria.ver')
  listar(@Query() q: { estado?: string; sucursalId?: string; pagina?: string; porPagina?: string }) {
    return this.traslados.listar(q);
  }

  @Get(':id') @RequierePermiso('tesoreria.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.traslados.obtener(id);
  }

  @Post() @RequierePermiso('tesoreria.operar')
  enviar(@Body(new ZodValidationPipe(esquemaTraslado)) d: DatosTraslado) {
    return this.traslados.enviar(d);
  }

  @Post(':id/recibir') @HttpCode(200) @RequierePermiso('tesoreria.aceptar')
  recibir(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRecepcion)) d: DatosRecepcion) {
    return this.traslados.recibir(id, d);
  }

  @Post(':id/anular') @HttpCode(200) @RequierePermiso('tesoreria.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnular)) d: z.infer<typeof esquemaAnular>) {
    return this.traslados.anular(id, d.motivo);
  }
}
