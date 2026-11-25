import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { esquemaVistaPrevia, type FiltroVistaPrevia } from './dto';
import { LotesFacturacionService } from './lotes.service';

@Controller('ventas/facturacion-lotes')
export class LotesFacturacionController {
  constructor(private readonly lotes: LotesFacturacionService) {}

  @Get('vista-previa')
  @RequierePermiso('venta.emitir')
  vistaPrevia(@Query(new ZodValidationPipe(esquemaVistaPrevia)) q: FiltroVistaPrevia) {
    return this.lotes.vistaPrevia(q);
  }
}
