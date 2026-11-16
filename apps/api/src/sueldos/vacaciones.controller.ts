import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { VacacionesService } from './vacaciones.service';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const esquemaPeriodo = z.object({ empleadoId: z.string().uuid(), anio: z.number().int().min(1950).max(2100), desde: fecha, hasta: fecha, liquidadoAfuera: z.boolean().optional(), observaciones: z.string().max(200).nullish() });
const esquemaSaldo = z.object({ empleadoId: z.string().uuid(), anio: z.number().int().min(1950).max(2100), dias: z.number().int().min(0).max(365).nullable() });

@Controller('sueldos')
export class VacacionesController {
  constructor(private readonly v: VacacionesService) {}

  @Get('vacaciones') @RequierePermiso('sueldos.ver')
  saldos(@Query('anio') anio: string) { return this.v.saldos(Number(anio)); }

  @Get('empleados/:id/vacaciones') @RequierePermiso('sueldos.ver')
  delEmpleado(@Param('id', ParseUUIDPipe) id: string) { return this.v.delEmpleado(id); }

  @Put('vacaciones/saldo-inicial') @RequierePermiso('sueldos.liquidar')
  saldoInicial(@Body(new ZodValidationPipe(esquemaSaldo)) d: z.infer<typeof esquemaSaldo>) { return this.v.saldoInicial(d); }

  @Post('vacaciones') @RequierePermiso('sueldos.liquidar')
  crear(@Body(new ZodValidationPipe(esquemaPeriodo)) d: z.infer<typeof esquemaPeriodo>) { return this.v.crear(d); }

  @Put('vacaciones/:id') @RequierePermiso('sueldos.liquidar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaPeriodo)) d: z.infer<typeof esquemaPeriodo>) { return this.v.modificar(id, d); }

  @Delete('vacaciones/:id') @HttpCode(200) @RequierePermiso('sueldos.liquidar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) { return this.v.eliminar(id); }
}
