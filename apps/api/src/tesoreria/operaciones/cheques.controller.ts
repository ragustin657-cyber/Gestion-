import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosDevolucion, DatosRechazo, esquemaDevolucion, esquemaRechazo } from './dto';
import { RechazosService } from './rechazos.service';

@Controller('tesoreria/cheques')
@RequierePermiso('tesoreria.aceptar')
export class ChequesController {
  constructor(private readonly rechazos: RechazosService) {}

  @Post(':id/rechazar') @HttpCode(200)
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRechazo)) d: DatosRechazo) {
    return this.rechazos.rechazar(id, d);
  }

  @Post(':id/devolver') @HttpCode(200)
  devolver(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaDevolucion)) d: DatosDevolucion) {
    return this.rechazos.devolver(id, d);
  }
}
