import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ModoTresVias } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { CONCEPTOS, ConceptoCuenta } from './conceptos';
import { ConfigComprasService } from './config-compras.service';

const noNegativo = z.number().min(0, 'No puede ser negativo');
const esquemaParametros = z.object({
  montoAprobacionOc: noNegativo.optional(),
  toleranciaPrecioPct: noNegativo.max(100).optional(),
  toleranciaCantidadPct: noNegativo.max(100).optional(),
  modoTresVias: z.nativeEnum(ModoTresVias).optional(),
});
const esquemaCuentas = z.array(
  z.object({ concepto: z.enum(CONCEPTOS as [ConceptoCuenta, ...ConceptoCuenta[]]), cuentaContableId: z.string().uuid() }),
);

@Controller('compras/config')
@RequierePermiso('compras.config')
export class ConfigComprasController {
  constructor(private readonly config: ConfigComprasService) {}

  @Get()
  obtener() {
    return this.config.obtener();
  }

  @Patch()
  modificar(@Body(new ZodValidationPipe(esquemaParametros)) d: z.infer<typeof esquemaParametros>) {
    return this.config.modificar(d);
  }

  @Put('cuentas')
  cuentas(@Body(new ZodValidationPipe(esquemaCuentas)) d: z.infer<typeof esquemaCuentas>) {
    return this.config.reemplazarCuentas(d);
  }
}
