import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { zMotivo } from '../../compras/comun';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { PeriodosService } from './periodos.service';
import { CierreEjercicioService } from '../cierre/cierre-ejercicio.service';

@Controller('contabilidad')
export class PeriodosController {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly cierre: CierreEjercicioService,
  ) {}

  @Get('ejercicios/:id/cierre/previa') @RequierePermiso('contabilidad.cerrar')
  previa(@Param('id', ParseUUIDPipe) id: string) {
    return this.cierre.previa(id);
  }

  @Post('ejercicios/:id/cerrar') @HttpCode(200) @RequierePermiso('contabilidad.cerrar')
  cerrarEjercicio(@Param('id', ParseUUIDPipe) id: string) {
    return this.cierre.cerrar(id);
  }

  @Post('ejercicios/:id/reabrir') @HttpCode(200) @RequierePermiso('contabilidad.cerrar')
  reabrirEjercicio(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ motivo: zMotivo }))) d: { motivo: string }) {
    return this.cierre.reabrir(id, d.motivo);
  }

  @Get('ejercicios') @RequierePermiso('plancuentas.ver')
  ejercicios() {
    return this.periodos.listar();
  }

  @Post('periodos/:id/cerrar') @HttpCode(200) @RequierePermiso('contabilidad.cerrar')
  cerrar(@Param('id', ParseUUIDPipe) id: string) {
    return this.periodos.cerrar(id);
  }

  @Post('periodos/:id/reabrir') @HttpCode(200) @RequierePermiso('contabilidad.cerrar')
  reabrir(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ motivo: zMotivo }))) d: { motivo: string }) {
    return this.periodos.reabrir(id, d.motivo);
  }

  @Post('ejercicios/siguiente') @RequierePermiso('contabilidad.cerrar')
  siguiente() {
    return this.periodos.siguiente();
  }
}
