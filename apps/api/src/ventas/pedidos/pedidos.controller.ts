import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosPedido, esquemaModPedido, esquemaMotivo, esquemaPedido } from './dto';
import { PedidosService } from './pedidos.service';

@Controller('ventas/pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get() @RequierePermiso('venta.ver')
  listar(@Query() q: { terceroId?: string; estado?: string; pendientes?: string }) {
    return this.pedidos.listar(q);
  }

  @Get(':id') @RequierePermiso('venta.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.obtener(id);
  }

  @Get(':id/pdf') @RequierePermiso('venta.ver')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.pedidos.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }

  @Post() @RequierePermiso('pedido.gestionar')
  crear(@Body(new ZodValidationPipe(esquemaPedido)) d: DatosPedido) {
    return this.pedidos.crear(d);
  }

  @Put(':id') @RequierePermiso('pedido.gestionar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModPedido)) d: DatosPedido & { version: number }) {
    return this.pedidos.modificar(id, d.version, d);
  }

  @Post(':id/confirmar') @RequierePermiso('pedido.gestionar')
  confirmar(@Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.confirmar(id);
  }

  @Post(':id/cerrar') @RequierePermiso('pedido.gestionar')
  cerrar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaMotivo)) d: { motivo: string }) {
    return this.pedidos.cerrar(id, d.motivo);
  }

  @Post(':id/anular') @RequierePermiso('pedido.gestionar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaMotivo)) d: { motivo: string }) {
    return this.pedidos.anular(id, d.motivo);
  }
}
