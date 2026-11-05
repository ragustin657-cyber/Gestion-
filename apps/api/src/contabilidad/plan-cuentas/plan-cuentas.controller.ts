import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { TipoCuenta } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zTexto } from '../../comun/esquemas';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { PlanCuentasService } from './plan-cuentas.service';

const esquemaAlta = z.object({
  codigo: z.string().trim().regex(/^\d+(\.\d+)*$/, 'Código inválido (ej. 1.1.01.001)'),
  nombre: zTexto,
  padreId: z.string().uuid().optional().nullable(),
  imputable: z.boolean(),
  tipo: z.nativeEnum(TipoCuenta).optional(),
});
const esquemaMod = z.object({ nombre: zTexto.optional(), imputable: z.boolean().optional(), activa: z.boolean().optional() });

@Controller('plan-cuentas')
export class PlanCuentasController {
  constructor(private readonly plan: PlanCuentasService) {}

  @Get()
  @RequierePermiso('plancuentas.ver')
  arbol() {
    return this.plan.arbol();
  }

  @Get('imputables')
  imputables() {
    return this.plan.imputables();
  }

  @Post()
  @RequierePermiso('plancuentas.editar')
  crear(@Body(new ZodValidationPipe(esquemaAlta)) d: z.infer<typeof esquemaAlta>) {
    return this.plan.crear(d);
  }

  @Patch(':id')
  @RequierePermiso('plancuentas.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaMod)) d: z.infer<typeof esquemaMod>) {
    return this.plan.modificar(id, d);
  }
}
