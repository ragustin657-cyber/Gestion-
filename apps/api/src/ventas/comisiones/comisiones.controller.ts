import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosVendedor, esquemaVendedor } from './dto';
import { VendedoresService } from './vendedores.service';

@Controller('ventas')
export class ComisionesController {
  constructor(private readonly vendedores: VendedoresService) {}

  @Get('vendedores') @RequierePermiso()
  listarVendedores() { return this.vendedores.listar(); }

  @Post('vendedores') @RequierePermiso('venta.maestros')
  crearVendedor(@Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.crear(d); }

  @Put('vendedores/:id') @RequierePermiso('venta.maestros')
  modificarVendedor(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaVendedor)) d: DatosVendedor) { return this.vendedores.modificar(id, d); }
}
