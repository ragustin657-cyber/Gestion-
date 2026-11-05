import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosOC, esquemaCerrar, esquemaMotivo, esquemaOC, esquemaVersion } from './dto';
import { FiltroOC, OrdenesService } from './ordenes.service';

const Id = () => Param('id', ParseUUIDPipe);

@Controller('compras/ordenes')
export class OrdenesController {
  constructor(private readonly ordenes: OrdenesService) {}

  @Get()
  @RequierePermiso('oc.ver')
  listar(@Query() f: FiltroOC) {
    return this.ordenes.listar(f);
  }

  @Get(':id')
  @RequierePermiso('oc.ver')
  obtener(@Id() id: string) {
    return this.ordenes.obtener(id);
  }

  @Post()
  @RequierePermiso('oc.crear')
  crear(@Body(new ZodValidationPipe(esquemaOC)) d: DatosOC) {
    return this.ordenes.crear(d);
  }

  @Patch(':id')
  @RequierePermiso('oc.crear')
  modificar(@Id() id: string, @Body(new ZodValidationPipe(esquemaOC)) d: DatosOC) {
    return this.ordenes.modificar(id, d);
  }

  @Delete(':id')
  @RequierePermiso('oc.crear')
  eliminar(@Id() id: string) {
    return this.ordenes.eliminar(id);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  @RequierePermiso('oc.crear')
  confirmar(@Id() id: string, @Body(new ZodValidationPipe(esquemaVersion)) b: { version: number }) {
    return this.ordenes.confirmar(id, b.version);
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  @RequierePermiso('oc.aprobar')
  aprobar(@Id() id: string, @Body(new ZodValidationPipe(esquemaVersion)) b: { version: number }) {
    return this.ordenes.aprobar(id, b.version);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @RequierePermiso('oc.aprobar')
  rechazar(@Id() id: string, @Body(new ZodValidationPipe(esquemaMotivo)) b: { version: number; motivo: string }) {
    return this.ordenes.rechazar(id, b.version, b.motivo);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermiso('oc.anular')
  anular(@Id() id: string, @Body(new ZodValidationPipe(esquemaMotivo)) b: { version: number; motivo: string }) {
    return this.ordenes.anular(id, b.version, b.motivo);
  }

  @Post(':id/cerrar')
  @HttpCode(200)
  @RequierePermiso('oc.aprobar')
  cerrar(@Id() id: string, @Body(new ZodValidationPipe(esquemaCerrar)) b: { version: number; motivo?: string | null }) {
    return this.ordenes.cerrar(id, b.version, b.motivo);
  }
}
