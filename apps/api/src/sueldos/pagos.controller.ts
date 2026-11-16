import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { PagosSueldosService } from './pagos.service';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const origen = { cuentaBancariaId: z.string().uuid().nullish(), cajaId: z.string().uuid().nullish() };
const esquemaPago = z.object({ fecha, ...origen, reciboIds: z.array(z.string().uuid()).min(1).optional() });
const esquemaPagoCargas = z.object({ anio: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), cuentaContableDeudaId: z.string().uuid(), importe: z.number().positive(), fecha, ...origen, detalle: z.string().max(200).nullish() });

@Controller('sueldos')
export class PagosSueldosController {
  constructor(private readonly p: PagosSueldosService) {}

  @Post('liquidaciones/:id/pagos') @RequierePermiso('sueldos.liquidar')
  pagar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaPago)) d: z.infer<typeof esquemaPago>) { return this.p.pagar(id, d); }

  @Post('pagos/:id/anular') @RequierePermiso('sueldos.liquidar')
  anular(@Param('id', ParseUUIDPipe) id: string) { return this.p.anular(id); }

  @Get('cargas-sociales') @RequierePermiso('sueldos.ver')
  cargas(@Query('anio') anio: string, @Query('mes') mes: string) { return this.p.cargasSociales(Number(anio), Number(mes)); }

  @Get('cargas-sociales/pagos') @RequierePermiso('sueldos.ver')
  pagosCargas(@Query('anio') anio: string, @Query('mes') mes: string) { return this.p.pagosCargas(Number(anio), Number(mes)); }

  @Post('cargas-sociales/pagos') @RequierePermiso('sueldos.liquidar')
  pagarCargas(@Body(new ZodValidationPipe(esquemaPagoCargas)) d: z.infer<typeof esquemaPagoCargas>) { return this.p.pagarCargas(d); }

  @Post('cargas-sociales/pagos/:id/anular') @RequierePermiso('sueldos.liquidar')
  anularCargas(@Param('id', ParseUUIDPipe) id: string) { return this.p.anularCargas(id); }
}
