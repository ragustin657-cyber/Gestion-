import { Body, Controller, Get, Put } from '@nestjs/common';
import { PeriodicidadArba } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigImpuestosService, DatosConfigImpuestos } from './config-impuestos.service';

const esquema = z.object({
  arbaActividad: z.string().trim().regex(/^\d{1,3}$/, 'Código de actividad inválido'),
  arbaSucursal: z.number().int().min(1).max(99999),
  arbaPeriodicidad: z.nativeEnum(PeriodicidadArba),
  agipCodigoNorma: z.string().trim().regex(/^\d{1,3}$/, 'Código de norma inválido'),
});

@Controller('impuestos/config')
export class ConfigImpuestosController {
  constructor(private readonly config: ConfigImpuestosService) {}

  @Get() @RequierePermiso('impuestos.ver')
  obtener() {
    return this.config.obtener();
  }

  @Put() @RequierePermiso('impuestos.presentar')
  guardar(@Body(new ZodValidationPipe(esquema)) d: DatosConfigImpuestos) {
    return this.config.guardar(d);
  }
}
