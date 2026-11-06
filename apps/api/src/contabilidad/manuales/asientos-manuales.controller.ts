import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { AsientosManualesService } from './asientos-manuales.service';
import { DatosAsientoManual, esquemaAnulacion, esquemaAsiento, esquemaModificacion } from './dto';

@Controller('contabilidad/asientos')
@RequierePermiso('asiento.registrar')
export class AsientosManualesController {
  constructor(private readonly manuales: AsientosManualesService) {}

  @Post()
  crear(@Body(new ZodValidationPipe(esquemaAsiento)) d: DatosAsientoManual) {
    return this.manuales.crear(d);
  }

  @Put(':id')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacion)) d: z.infer<typeof esquemaModificacion>) {
    const { version, ...datos } = d;
    return this.manuales.modificar(id, version, datos);
  }

  @Delete(':id')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.manuales.eliminar(id);
  }

  @Post(':id/anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAnulacion)) d: z.infer<typeof esquemaAnulacion>) {
    return this.manuales.anular(id, d.fecha, d.motivo);
  }
}
