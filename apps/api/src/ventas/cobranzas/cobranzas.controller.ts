import { Body, Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosGestion, esquemaGestion } from './dto';
import { GestionesService } from './gestiones.service';

@Controller('ventas/cobranzas')
export class CobranzasController {
  constructor(private readonly gestiones: GestionesService) {}

  @Post(':terceroId/gestiones') @RequierePermiso('cobranzas.gestionar')
  crear(@Param('terceroId', ParseUUIDPipe) terceroId: string, @Body(new ZodValidationPipe(esquemaGestion)) d: DatosGestion) { return this.gestiones.crear(terceroId, d); }

  @Delete('gestiones/:id') @RequierePermiso('cobranzas.gestionar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) { return this.gestiones.eliminar(id); }
}
