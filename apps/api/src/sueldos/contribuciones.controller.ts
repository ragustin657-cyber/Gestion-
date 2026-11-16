import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { ContribucionesService, DatosConfiguracion, DatosContribucion } from './contribuciones.service';

const uuid = z.string().uuid('Valor inválido');
const esquemaContribucion = z.object({
  codigo: z.string().trim().min(1).max(10), nombre: z.string().trim().min(1).max(100), destino: z.enum(['SEGURIDAD_SOCIAL', 'OBRA_SOCIAL', 'ART', 'SEGURO_VIDA']),
  alicuota: z.number().min(0).max(100), importeFijo: z.number().min(0).default(0), aplicaDetraccion: z.boolean().default(false), cuentaContableId: uuid,
  desdeAnio: z.number().int().min(2000).max(2100), desdeMes: z.number().int().min(1).max(12), activa: z.boolean().optional(),
});
const esquemaParametros = z.object({ anio: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), baseMaximaAportes: z.number().positive().nullable(), detraccion: z.number().min(0) });
const esquemaConfiguracion = z.object({ cuentaSueldosId: uuid, cuentaContribucionesId: uuid, cuentaSueldosAPagarId: uuid, cuentaCargasSocialesId: uuid, cuentaRetencionesSindicalesId: uuid, cuentaIndemnizacionesId: uuid.nullish() });

@Controller('sueldos')
export class ContribucionesController {
  constructor(private readonly c: ContribucionesService) {}

  @Get('contribuciones') @RequierePermiso('sueldos.ver')
  listar(@Query('anio') anio?: string, @Query('mes') mes?: string) { return this.c.listar(anio ? Number(anio) : undefined, mes ? Number(mes) : undefined); }

  @Post('contribuciones') @RequierePermiso('sueldos.liquidar')
  crear(@Body(new ZodValidationPipe(esquemaContribucion)) d: DatosContribucion) { return this.c.crear(d); }

  @Put('contribuciones/:id') @RequierePermiso('sueldos.liquidar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaContribucion)) d: DatosContribucion) { return this.c.modificar(id, d); }

  @Get('parametros') @RequierePermiso('sueldos.ver')
  parametros(@Query('anio') anio: string, @Query('mes') mes: string) { return this.c.verParametros(Number(anio), Number(mes)); }

  @Put('parametros') @RequierePermiso('sueldos.liquidar')
  guardarParametros(@Body(new ZodValidationPipe(esquemaParametros)) d: z.infer<typeof esquemaParametros>) { return this.c.guardarParametros(d); }

  @Get('configuracion') @RequierePermiso('sueldos.ver')
  configuracion() { return this.c.verConfiguracion(); }

  @Put('configuracion') @RequierePermiso('sueldos.liquidar')
  guardarConfiguracion(@Body(new ZodValidationPipe(esquemaConfiguracion)) d: DatosConfiguracion) { return this.c.guardarConfiguracion(d); }
}
