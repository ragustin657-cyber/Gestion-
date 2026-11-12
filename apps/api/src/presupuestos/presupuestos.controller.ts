import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { DatosLinea, DatosPresupuesto, esquemaLinea, esquemaModificacion, esquemaPresupuesto } from './dto';
import { PresupuestosService } from './presupuestos.service';

@Controller('presupuestos')
export class PresupuestosController {
  constructor(private readonly presupuestos: PresupuestosService) {}

  @Get()
  @RequierePermiso('presupuesto.ver')
  listar(@Query('ejercicioId') ejercicioId?: string) {
    return this.presupuestos.listar(ejercicioId);
  }

  @Post()
  @RequierePermiso('presupuesto.editar')
  crear(@Body(new ZodValidationPipe(esquemaPresupuesto)) d: DatosPresupuesto) {
    return this.presupuestos.crear(d);
  }

  @Put(':id')
  @RequierePermiso('presupuesto.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacion)) d: { nombre: string; observaciones?: string | null }) {
    return this.presupuestos.modificar(id, d);
  }

  @Post(':id/vigente')
  @RequierePermiso('presupuesto.editar')
  vigente(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.marcarVigente(id);
  }

  @Delete(':id')
  @RequierePermiso('presupuesto.editar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.eliminar(id);
  }

  @Get(':id/grilla')
  @RequierePermiso('presupuesto.ver')
  grilla(@Param('id', ParseUUIDPipe) id: string) {
    return this.presupuestos.grilla(id);
  }

  @Put(':id/lineas')
  @RequierePermiso('presupuesto.editar')
  guardarLinea(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaLinea)) d: DatosLinea) {
    return this.presupuestos.guardarLinea(id, d);
  }

  @Delete(':id/lineas')
  @HttpCode(200)
  @RequierePermiso('presupuesto.editar')
  eliminarLinea(@Param('id', ParseUUIDPipe) id: string, @Query('cuentaContableId', ParseUUIDPipe) cuentaContableId: string, @Query('centroCostoId') centroCostoId?: string) {
    return this.presupuestos.eliminarLinea(id, cuentaContableId, centroCostoId || null);
  }
}
