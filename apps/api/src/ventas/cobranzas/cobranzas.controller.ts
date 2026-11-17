import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AgendaCobranzasService } from './agenda.service';
import { RequiereAlguno, RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosGestion, esquemaGestion } from './dto';
import { GestionesService } from './gestiones.service';

@Controller('ventas/cobranzas')
export class CobranzasController {
  constructor(private readonly gestiones: GestionesService, private readonly agenda: AgendaCobranzasService) {}

  @Get() @RequiereAlguno('venta.ver', 'cobranzas.gestionar')
  listar(@Query() q: { soloHoy?: string; incumplidas?: string; minDias?: string; q?: string }) { return this.agenda.agenda(q); }

  @Get(':terceroId') @RequiereAlguno('venta.ver', 'cobranzas.gestionar')
  ficha(@Param('terceroId', ParseUUIDPipe) terceroId: string) { return this.agenda.ficha(terceroId); }

  @Post(':terceroId/gestiones') @RequierePermiso('cobranzas.gestionar')
  crear(@Param('terceroId', ParseUUIDPipe) terceroId: string, @Body(new ZodValidationPipe(esquemaGestion)) d: DatosGestion) { return this.gestiones.crear(terceroId, d); }

  @Delete('gestiones/:id') @RequierePermiso('cobranzas.gestionar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) { return this.gestiones.eliminar(id); }
}
