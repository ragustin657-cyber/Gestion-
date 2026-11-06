import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ChequesPropiosService } from './cheques-propios.service';
import { DatosDebito, DatosDevolucion, DatosRechazo, esquemaDebito, esquemaDevolucion, esquemaRechazo } from './dto';
import { RechazosService } from './rechazos.service';

@Controller('tesoreria')
@RequierePermiso('tesoreria.aceptar')
export class ChequesController {
  constructor(
    private readonly rechazos: RechazosService,
    private readonly propios: ChequesPropiosService,
  ) {}

  @Get('cheques-propios') @RequierePermiso('tesoreria.ver')
  chequesPropios(@Query() q: { estado?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    return this.propios.listar(q);
  }

  @Post('cheques-propios/debitar') @HttpCode(200)
  debitar(@Body(new ZodValidationPipe(esquemaDebito)) d: DatosDebito) {
    return this.propios.debitar(d);
  }

  @Post('cheques/:id/rechazar') @HttpCode(200)
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRechazo)) d: DatosRechazo) {
    return this.rechazos.rechazar(id, d);
  }

  @Post('cheques/:id/devolver') @HttpCode(200)
  devolver(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaDevolucion)) d: DatosDevolucion) {
    return this.rechazos.devolver(id, d);
  }
}
