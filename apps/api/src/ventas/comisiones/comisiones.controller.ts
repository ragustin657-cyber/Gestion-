import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
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
  ) {}

  @Get('comisiones') @RequierePermiso('venta.ver')
  consulta(@Query('anio') anio: string, @Query('mes') mes: string) { return this.calculo.consulta(Number(anio), Number(mes)); }

  @Get('vendedores') @RequierePermiso()
  listarVendedores() { return this.vendedores.listar(); }

  @Post('vendedores') @RequierePermiso('venta.maestros')
  crearVendedor(@Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.crear(d); }

  @Put('vendedores/:id') @RequierePermiso('venta.maestros')
  modificarVendedor(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.modificar(id, d); }
}
