import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { LiquidacionesService, NovedadEntrada } from './liquidaciones.service';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const esquemaLiquidacion = z.object({ tipo: z.enum(['MENSUAL', 'SAC']), anio: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), fechaPago: fecha });
const esquemaNovedades = z.object({
  empleadoId: z.string().uuid(),
  novedades: z.array(z.object({ tipo: z.enum(['HORAS_EXTRA_50', 'HORAS_EXTRA_100', 'AUSENCIA_INJUSTIFICADA', 'IMPORTE']), conceptoId: z.string().uuid().nullish(), cantidad: z.number().min(0).nullish(), importe: z.number().nullish(), detalle: z.string().max(200).nullish() })),
});
const esquemaDeposito = z.object({ fecha, banco: z.string().trim().min(1).max(100), periodo: z.string().trim().min(1).max(20) });

@Controller('sueldos/liquidaciones')
export class LiquidacionesController {
  constructor(private readonly l: LiquidacionesService) {}

  @Get() @RequierePermiso('sueldos.ver')
  listar() { return this.l.listar(); }

  @Post() @RequierePermiso('sueldos.liquidar')
  crear(@Body(new ZodValidationPipe(esquemaLiquidacion)) d: z.infer<typeof esquemaLiquidacion>) { return this.l.crear(d); }

  @Get(':id') @RequierePermiso('sueldos.ver')
  obtener(@Param('id', ParseUUIDPipe) id: string) { return this.l.obtener(id); }

  @Put(':id/novedades') @RequierePermiso('sueldos.liquidar')
  novedades(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaNovedades)) d: { empleadoId: string; novedades: NovedadEntrada[] }) { return this.l.guardarNovedades(id, d.empleadoId, d.novedades); }

  @Post(':id/recalcular') @RequierePermiso('sueldos.liquidar')
  recalcular(@Param('id', ParseUUIDPipe) id: string) { return this.l.recalcular(id); }

  @Post(':id/cerrar') @RequierePermiso('sueldos.liquidar')
  cerrar(@Param('id', ParseUUIDPipe) id: string) { return this.l.cerrar(id); }

  @Post(':id/reabrir') @RequierePermiso('sueldos.liquidar')
  reabrir(@Param('id', ParseUUIDPipe) id: string) { return this.l.reabrir(id); }

  @Put(':id/deposito') @RequierePermiso('sueldos.liquidar')
  deposito(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaDeposito)) d: z.infer<typeof esquemaDeposito>) { return this.l.deposito(id, d); }

  @Delete(':id') @HttpCode(200) @RequierePermiso('sueldos.liquidar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) { return this.l.eliminar(id); }
}
