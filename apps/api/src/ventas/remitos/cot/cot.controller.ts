import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../../comun/zod.pipe';
import { ConfigCotService, type DatosConfigCot } from './config-cot.service';

const esquemaConfig = z.object({
  activo: z.boolean().optional(),
  ambiente: z.enum(['SIMULADO', 'PRUEBA', 'PRODUCCION']).optional(),
  usuario: z.string().trim().regex(/^\d{11}$/, 'CUIT inválido').nullish(),
  clave: z.string().min(1).nullish(),
  pedirAlConfirmar: z.boolean().optional(),
});

/** E57: COT de ARBA. */
@Controller('ventas/cot')
export class CotController {
  constructor(private readonly config: ConfigCotService) {}

  @Get('config') @RequierePermiso('impuestos.ver')
  obtener() {
    return this.config.obtener();
  }

  @Put('config') @RequierePermiso('impuestos.presentar')
  guardar(@Body(new ZodValidationPipe(esquemaConfig)) d: DatosConfigCot) {
    return this.config.guardar(d);
  }
}
