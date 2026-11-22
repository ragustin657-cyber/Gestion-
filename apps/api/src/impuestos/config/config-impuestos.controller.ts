import { Body, Controller, Get, Put } from '@nestjs/common';
import { PeriodicidadArba } from '@prisma/client';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigImpuestosService, DatosConfigImpuestos } from './config-impuestos.service';

/** Revisión E47: los importes decimales llegan como texto en el GET (Decimal); se aceptan así al reenviarlos. */
const decimal = () => z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v), z.number());
const esquema = z.object({
  arbaActividad: z.string().trim().regex(/^\d{1,3}$/, 'Código de actividad inválido'),
  arbaSucursal: z.number().int().min(1).max(99999),
  arbaPeriodicidad: z.nativeEnum(PeriodicidadArba),
  agipCodigoNorma: z.string().trim().regex(/^\d{1,3}$/, 'Código de norma inválido'),
  // Posición de IVA (E37)
  ivaInicioAnio: z.number().int().min(2000).max(2100).nullish(),
  ivaInicioMes: z.number().int().min(1).max(12).nullish(),
  ivaSaldoTecnicoInicial: decimal().pipe(z.number().min(0, 'No puede ser negativo')).optional(),
  ivaSaldoLibreInicial: decimal().pipe(z.number().min(0, 'No puede ser negativo')).optional(),
  // Liquidación de IIBB (E38)
  iibbInicioAnio: z.number().int().min(2000).max(2100).nullish(),
  iibbInicioMes: z.number().int().min(1).max(12).nullish(),
  // Prorrateo del crédito fiscal (E40)
  prorrateoIva: z.boolean().optional(),
  prorrateoDesdeAnio: z.number().int().min(2000).max(2100).nullish(),
  prorrateoDesdeMes: z.number().int().min(1).max(12).nullish(),
  prorrateoInicioMes: z.number().int().min(1).max(12).optional(),
  prorrateoGravadasIniciales: decimal().optional(),
  prorrateoExentasIniciales: decimal().optional(),
  // Motivo de anulación del F.2005 (E43; tabla del SIRE, a verificar)
  sireMotivoAnulacion: z.number().int().min(1).max(9).optional(),
  // Tope de costo de automóviles para la amortización impositiva (E44)
  topeAutomovilesCosto: decimal().pipe(z.number().min(0, 'No puede ser negativo')).optional(),
  // Alícuota de Bienes Personales, acciones y participaciones (E47)
  alicuotaBienesPersonalesAcciones: decimal().pipe(z.number().min(0).max(100)).optional(),
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
