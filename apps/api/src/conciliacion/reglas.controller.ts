import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosRegla, esquemaRegla } from './dto';
import { ReglasService } from './reglas.service';

@Controller('conciliacion/reglas')
@RequierePermiso('conciliacion.operar')
export class ReglasController {
  constructor(private readonly reglas: ReglasService) {}

  @Get()
  listar() {
    return this.reglas.listar();
  }

  @Post()
  crear(@Body(new ZodValidationPipe(esquemaRegla)) d: DatosRegla) {
    return this.reglas.crear(d);
  }

  @Patch(':id')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegla.partial())) d: Partial<DatosRegla>) {
    return this.reglas.modificar(id, d);
  }
}
