import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import {
  AltaTercero, esquemaAltaTercero, esquemaIibb, esquemaModTercero, IibbTercero, ModTercero,
} from './dto';
import { FiltroTerceros, TercerosService } from './terceros.service';

@Controller('terceros')
export class TercerosController {
  constructor(private readonly terceros: TercerosService) {}

  @Get()
  @RequierePermiso('tercero.ver')
  listar(@Query() f: FiltroTerceros) {
    return this.terceros.listar(f);
  }

  @Get(':id')
  @RequierePermiso('tercero.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.terceros.obtener(id);
  }

  @Post()
  @RequierePermiso('tercero.editar')
  crear(@Body(new ZodValidationPipe(esquemaAltaTercero)) d: AltaTercero) {
    return this.terceros.crear(d);
  }

  @Patch(':id')
  @RequierePermiso('tercero.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModTercero)) d: ModTercero) {
    return this.terceros.modificar(id, d);
  }

  @Put(':id/iibb')
  @RequierePermiso('tercero.editar')
  iibb(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaIibb)) d: IibbTercero) {
    return this.terceros.reemplazarIibb(id, d);
  }
}
