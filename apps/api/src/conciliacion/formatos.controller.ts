import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosFormato, esquemaFormato } from './dto';
import { FormatosService } from './formatos.service';
import { MODELOS_FORMATO } from './modelos-formato';

@Controller('conciliacion/formatos')
@RequierePermiso('tesoreria.maestros.editar')
export class FormatosController {
  constructor(private readonly formatos: FormatosService) {}

  @Get() @RequierePermiso()
  listar() {
    return this.formatos.listar();
  }

  @Get('modelos') @RequierePermiso()
  modelos() {
    return MODELOS_FORMATO;
  }

  @Put(':cuentaBancariaId')
  guardar(@Param('cuentaBancariaId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaFormato)) d: DatosFormato) {
    return this.formatos.guardar(id, d);
  }
}
