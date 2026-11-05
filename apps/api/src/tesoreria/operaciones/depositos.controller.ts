import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { AcreditacionesService } from './acreditaciones.service';
import { DepositosService } from './depositos.service';
import { DatosAcreditacion, DatosDeposito, esquemaAcreditacion, esquemaAnular, esquemaDeposito } from './dto';

@Controller('tesoreria')
export class DepositosController {
  constructor(
    private readonly depositos: DepositosService,
    private readonly acreditaciones: AcreditacionesService,
  ) {}

  @Get('depositos') @RequierePermiso('tesoreria.ver')
  listar(@Query() q: { pagina?: string; porPagina?: string }) {
    return this.depositos.listar(q);
  }

  @Get('depositos/:id') @RequierePermiso('tesoreria.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.depositos.obtener(id);
  }

  @Post('depositos') @RequierePermiso('tesoreria.operar')
  crear(@Body(new ZodValidationPipe(esquemaDeposito)) d: DatosDeposito) {
    return this.depositos.crear(d);
  }

  @Post('depositos/:id/anular') @HttpCode(200) @RequierePermiso('tesoreria.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnular)) d: z.infer<typeof esquemaAnular>) {
    return this.depositos.anular(id, d.motivo);
  }

  @Post('acreditaciones') @HttpCode(200) @RequierePermiso('tesoreria.aceptar')
  acreditar(@Body(new ZodValidationPipe(esquemaAcreditacion)) d: DatosAcreditacion) {
    return this.acreditaciones.acreditar(d);
  }

  @Get('pendientes-acreditar') @RequierePermiso('tesoreria.ver')
  pendientes() {
    return this.acreditaciones.pendientes();
  }
}
