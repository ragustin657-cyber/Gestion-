import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { zTexto } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { esquemaEscalas, type DatosEscalas } from '../ventas/precios/escalas';
import { RubrosArticulosService } from './rubros.service';

const esquema = z.object({ nombre: zTexto, activo: z.boolean().optional() });

@Controller('rubros-articulos')
export class RubrosArticulosController {
  constructor(private readonly rubros: RubrosArticulosService) {}

  @Get()
  @RequierePermiso('articulo.ver')
  listar(@Query('activos') activos?: string) {
    return this.rubros.listar(activos === '1' || activos === 'true');
  }

  @Post()
  @RequierePermiso('articulo.editar')
  crear(@Body(new ZodValidationPipe(esquema)) d: z.infer<typeof esquema>) {
    return this.rubros.crear(d);
  }

  @Patch(':id')
  @RequierePermiso('articulo.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquema.partial())) d: Partial<z.infer<typeof esquema>>) {
    return this.rubros.modificar(id, d);
  }

  @Get(':id/escalas')
  @RequierePermiso('articulo.ver')
  escalas(@Param('id', ParseUUIDPipe) id: string) {
    return this.rubros.escalas(id);
  }

  @Put(':id/escalas')
  @RequierePermiso('articulo.editar')
  guardarEscalas(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaEscalas)) d: DatosEscalas) {
    return this.rubros.guardarEscalas(id, d);
  }
}
