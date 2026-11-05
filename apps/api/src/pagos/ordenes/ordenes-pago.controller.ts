import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosOP, DatosPagar, esquemaMotivo, esquemaOP, esquemaPagar, esquemaVersion } from './dto';
import { PagoService } from './pago.service';
import { OrdenesPagoService } from './ordenes-pago.service';

const Id = () => Param('id', ParseUUIDPipe);

@Controller('pagos')
export class OrdenesPagoController {
  constructor(
    private readonly ordenes: OrdenesPagoService,
    private readonly pago: PagoService,
  ) {}

  @Get('pendientes')
  @RequierePermiso('op.crear')
  pendientes(@Query('terceroId', ParseUUIDPipe) terceroId: string) {
    return this.ordenes.pendientes(terceroId);
  }

  @Get('ordenes')
  @RequierePermiso('op.ver')
  listar(@Query() f: { terceroId?: string; estado?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    return this.ordenes.listar(f);
  }

  @Get('ordenes/:id')
  @RequierePermiso('op.ver')
  obtener(@Id() id: string) {
    return this.ordenes.obtener(id);
  }

  @Post('ordenes')
  @RequierePermiso('op.crear')
  crear(@Body(new ZodValidationPipe(esquemaOP)) d: DatosOP) {
    return this.ordenes.crear(d);
  }

  @Patch('ordenes/:id')
  @RequierePermiso('op.crear')
  modificar(@Id() id: string, @Body(new ZodValidationPipe(esquemaOP)) d: DatosOP) {
    return this.ordenes.modificar(id, d);
  }

  @Delete('ordenes/:id')
  @RequierePermiso('op.crear')
  eliminar(@Id() id: string) {
    return this.ordenes.eliminar(id);
  }

  @Post('ordenes/:id/confirmar')
  @HttpCode(200)
  @RequierePermiso('op.crear')
  confirmar(@Id() id: string, @Body(new ZodValidationPipe(esquemaVersion)) b: { version: number }) {
    return this.ordenes.confirmar(id, b.version);
  }

  @Post('ordenes/:id/aprobar')
  @HttpCode(200)
  @RequierePermiso('op.aprobar')
  aprobar(@Id() id: string, @Body(new ZodValidationPipe(esquemaVersion)) b: { version: number }) {
    return this.ordenes.aprobar(id, b.version);
  }

  @Post('ordenes/:id/rechazar')
  @HttpCode(200)
  @RequierePermiso('op.aprobar')
  rechazar(@Id() id: string, @Body(new ZodValidationPipe(esquemaMotivo)) b: { version: number; motivo: string }) {
    return this.ordenes.rechazar(id, b.version, b.motivo);
  }

  @Post('ordenes/:id/anular')
  @HttpCode(200)
  @RequierePermiso('op.anular')
  anular(@Id() id: string, @Body(new ZodValidationPipe(esquemaMotivo)) b: { version: number; motivo: string }) {
    return this.ordenes.anularNoPagada(id, b.version, b.motivo);
  }

  @Post('ordenes/:id/pagar')
  @HttpCode(200)
  @RequierePermiso('pago.ejecutar')
  pagar(@Id() id: string, @Body(new ZodValidationPipe(esquemaPagar)) b: DatosPagar) {
    return this.pago.pagar(id, b.version, b.fechaPago, b.medios);
  }
}
