import { Controller, Get, Post } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { PeriodosService } from './periodos.service';

@Controller('contabilidad')
export class PeriodosController {
  constructor(private readonly periodos: PeriodosService) {}

  @Get('ejercicios') @RequierePermiso('plancuentas.ver')
  ejercicios() {
    return this.periodos.listar();
  }

  @Post('ejercicios/siguiente') @RequierePermiso('contabilidad.cerrar')
  siguiente() {
    return this.periodos.siguiente();
  }
}
