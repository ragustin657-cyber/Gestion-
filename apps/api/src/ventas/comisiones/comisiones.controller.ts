import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { LiquidacionesComisionesService } from './liquidaciones.service';
import { ComisionesCalculoService } from './calculo.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosVendedor, esquemaVendedor } from './dto';
import { VendedoresService } from './vendedores.service';

@Controller('ventas')
export class ComisionesController {
  constructor(
    private readonly vendedores: VendedoresService,
    private readonly calculo: ComisionesCalculoService,
    private readonly liquidaciones: LiquidacionesComisionesService,
  ) {}

  @Post('comisiones') @RequierePermiso('comisiones.liquidar')
  confirmar(@Body(new ZodValidationPipe(z.object({ anio: z.number().int(), mes: z.number().int().min(1).max(12) }))) d: { anio: number; mes: number }) { return this.liquidaciones.confirmar(d.anio, d.mes); }

  @Get('comisiones/liquidaciones') @RequierePermiso('venta.ver')
  listarLiquidaciones() { return this.liquidaciones.listar(); }

  @Post('comisiones/liquidaciones/:id/anular') @RequierePermiso('comisiones.liquidar')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ motivo: z.string().trim().min(1, 'Indique el motivo') }))) d: { motivo: string }) { return this.liquidaciones.anular(id, d.motivo); }

  @Get('comisiones/liquidaciones/:id/pdf') @RequierePermiso('venta.ver')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Query('vendedorId') vendedorId: string, @Res({ passthrough: true }) res: Response) {
    const { nombre, contenido } = await this.liquidaciones.pdf(id, vendedorId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` });
    return new StreamableFile(contenido);
  }

  @Get('comisiones') @RequierePermiso('venta.ver')
  consulta(@Query('anio') anio: string, @Query('mes') mes: string) { return this.calculo.consulta(Number(anio), Number(mes)); }

  @Get('vendedores') @RequierePermiso()
  listarVendedores() { return this.vendedores.listar(); }

  @Post('vendedores') @RequierePermiso('venta.maestros')
  crearVendedor(@Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.crear(d); }

  @Put('vendedores/:id') @RequierePermiso('venta.maestros')
  modificarVendedor(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.modificar(id, d); }
}
