import { Body, Controller, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { EgresosService } from './egresos.service';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const datos = {
  causa: z.enum(['RENUNCIA', 'DESPIDO_SIN_CAUSA', 'DESPIDO_CON_CAUSA', 'MUTUO_ACUERDO']), fechaEgreso: fecha, preavisoOtorgado: z.boolean().default(false),
  mejorRemuneracion: z.number().positive().nullish(), gratificacion: z.number().min(0).default(0), fechaPago: fecha,
};
const esquemaAlta = z.object({ empleadoId: z.string().uuid(), ...datos });
const esquemaModificacion = z.object(datos);

@Controller('sueldos/egresos')
export class EgresosController {
  constructor(private readonly e: EgresosService) {}

  @Post() @RequierePermiso('sueldos.liquidar')
  crear(@Body(new ZodValidationPipe(esquemaAlta)) d: z.infer<typeof esquemaAlta>) { return this.e.crear(d); }

  @Put(':id') @RequierePermiso('sueldos.liquidar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaModificacion)) d: z.infer<typeof esquemaModificacion>) { return this.e.modificar(id, d); }
}
