import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosRubro, esquemaRubro } from './dto';
import { RubrosService } from './rubros.service';

@Controller('bienes-uso/rubros')
export class RubrosController {
  constructor(private readonly rubros: RubrosService) {}

  @Get()
  @RequierePermiso('bienes.ver')
  listar() {
    return this.rubros.listar();
  }

  @Post()
  @RequierePermiso('bienes.gestionar')
  crear(@Body(new ZodValidationPipe(esquemaRubro)) d: DatosRubro) {
    return this.rubros.crear(d);
  }

  @Put(':id')
  @RequierePermiso('bienes.gestionar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRubro)) d: DatosRubro) {
    return this.rubros.modificar(id, d);
  }
}
