import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosTarjeta, TarjetasService } from './tarjetas.service';

const esquemaTarjeta = z.object({
  nombre: z.string().trim().min(1).max(60), tipo: z.enum(['CREDITO', 'DEBITO', 'QR']), cuentaBancariaId: z.string().uuid(),
  cuentaContableId: z.string().uuid().nullish(), activa: z.boolean().optional(),
});

@Controller('tesoreria')
export class TarjetasController {
  constructor(private readonly t: TarjetasService) {}

  @Get('tarjetas') @RequierePermiso()
  listar() { return this.t.listar(); }

  @Get('cupones') @RequierePermiso('tesoreria.ver')
  cupones(@Query() q: { tarjetaId?: string; estado?: string; desde?: string; hasta?: string }) { return this.t.cupones(q); }

  @Post('tarjetas') @RequierePermiso('tesoreria.maestros.editar')
  crear(@Body(new ZodValidationPipe(esquemaTarjeta)) d: DatosTarjeta) { return this.t.crear(d); }

  @Put('tarjetas/:id') @RequierePermiso('tesoreria.maestros.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaTarjeta)) d: DatosTarjeta) { return this.t.modificar(id, d); }
}
