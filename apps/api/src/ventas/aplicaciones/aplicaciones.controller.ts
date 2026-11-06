import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zFecha } from '../../compras/comun';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { AplicacionesService } from './aplicaciones.service';

const esquema = z.object({
  terceroId: z.string().uuid('Valor inválido'),
  fecha: zFecha,
  items: z.array(z.object({ creditoMovId: z.string().uuid('Valor inválido'), debitoMovId: z.string().uuid('Valor inválido'), importe: z.number().gt(0, 'Debe ser mayor a cero') })).min(1, 'Indique qué aplicar'),
});

@Controller('ventas')
export class AplicacionesController {
  constructor(private readonly aplicaciones: AplicacionesService) {}

  @Post('aplicaciones') @RequierePermiso('cobro.registrar')
  aplicar(@Body(new ZodValidationPipe(esquema)) d: z.infer<typeof esquema>) {
    return this.aplicaciones.aplicar(d);
  }

  @Post('aplicaciones/:id/anular') @HttpCode(200) @RequierePermiso('cobro.registrar')
  anular(@Param('id', ParseUUIDPipe) id: string) {
    return this.aplicaciones.anular(id);
  }

  @Get('clientes/:id/pendientes') @RequierePermiso('cobro.registrar')
  pendientes(@Param('id', ParseUUIDPipe) id: string) {
    return this.aplicaciones.pendientes(id);
  }
}
