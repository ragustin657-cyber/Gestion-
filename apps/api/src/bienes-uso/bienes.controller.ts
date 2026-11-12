import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { BienesService } from './bienes.service';
import { DatosBien, EdicionBien, esquemaBien, esquemaEdicionBien } from './dto';

@Controller('bienes-uso')
export class BienesController {
  constructor(private readonly bienes: BienesService) {}

  @Get()
  @RequierePermiso('bienes.ver')
  listar(@Query() q: { rubroId?: string; estado?: string; q?: string }) {
    return this.bienes.listar(q);
  }

  @Get(':id')
  @RequierePermiso('bienes.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.bienes.obtener(id);
  }

  @Post()
  @RequierePermiso('bienes.gestionar')
  crear(@Body(new ZodValidationPipe(esquemaBien)) d: DatosBien) {
    return this.bienes.crear(d);
  }

  @Put(':id')
  @RequierePermiso('bienes.gestionar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaEdicionBien)) d: EdicionBien) {
    return this.bienes.modificar(id, d);
  }

  @Delete(':id')
  @RequierePermiso('bienes.gestionar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.bienes.eliminar(id);
  }
}
