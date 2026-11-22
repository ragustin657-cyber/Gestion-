import { Body, Controller, Post } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ComprobantesService } from './comprobantes.service';
import { DatosDespacho, esquemaDespacho } from './dto';

/** Despachos de importación (E41). */
@Controller('compras/despachos')
export class DespachosController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Post()
  @RequierePermiso('fc.crear')
  crear(@Body(new ZodValidationPipe(esquemaDespacho)) d: DatosDespacho) {
    return this.comprobantes.crearDespacho(d);
  }
}
