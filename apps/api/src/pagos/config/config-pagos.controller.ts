import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { SinPadron } from '@prisma/client';
import { z } from 'zod';
import { RequiereAlguno, RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zTexto } from '../../comun/esquemas';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { ConfigPagosService } from './config-pagos.service';

const noNeg = z.number().min(0, 'No puede ser negativo');
const esquemaRegimen = z.object({
  codigo: zTexto, descripcion: zTexto, minimoNoSujeto: noNeg, alicuotaInscripto: noNeg.max(100), alicuotaNoInscripto: noNeg.max(100),
  usaEscala: z.boolean().optional(), minimoRetencion: noNeg, activo: z.boolean().optional(),
});
const esquemaEscala = z.array(z.object({ desde: noNeg, hasta: noNeg.nullable(), fijo: noNeg, porcentaje: noNeg.max(100) })).min(1);
const esquemaJurisdicciones = z.array(z.object({
  jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'), alicuotaDefecto: noNeg.max(100), minimoRetencion: noNeg,
  usaPadron: z.boolean(), sinPadron: z.nativeEnum(SinPadron),
}));

@Controller('pagos/config')
@RequierePermiso('retenciones.config')
export class ConfigPagosController {
  constructor(private readonly config: ConfigPagosService) {}

  @Get()
  @RequierePermiso()
  @RequiereAlguno('retenciones.config', 'op.crear', 'op.ver')
  parametros() {
    return this.config.parametros();
  }

  @Patch()
  modificar(@Body(new ZodValidationPipe(z.object({ montoAprobacionOp: noNeg.optional() }))) d: { montoAprobacionOp?: number }) {
    return this.config.modificar(d);
  }

  @Get('regimenes')
  @RequierePermiso()
  @RequiereAlguno('retenciones.config', 'op.crear', 'tercero.editar')
  regimenes() {
    return this.config.regimenes();
  }

  @Post('regimenes')
  crearRegimen(@Body(new ZodValidationPipe(esquemaRegimen)) d: z.infer<typeof esquemaRegimen>) {
    return this.config.crearRegimen(d);
  }

  @Patch('regimenes/:id')
  modificarRegimen(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegimen.partial())) d: Partial<z.infer<typeof esquemaRegimen>>) {
    return this.config.modificarRegimen(id, d);
  }

  @Get('escala')
  escala() {
    return this.config.escala();
  }

  @Put('escala')
  reemplazarEscala(@Body(new ZodValidationPipe(esquemaEscala)) d: z.infer<typeof esquemaEscala>) {
    return this.config.reemplazarEscala(d);
  }

  @Get('jurisdicciones')
  jurisdicciones() {
    return this.config.todasLasJurisdicciones();
  }

  @Put('jurisdicciones')
  reemplazarJurisdicciones(@Body(new ZodValidationPipe(esquemaJurisdicciones)) d: z.infer<typeof esquemaJurisdicciones>) {
    return this.config.reemplazarJurisdicciones(d);
  }
}
