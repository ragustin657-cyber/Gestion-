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
// Código de régimen de la tabla REGIMEN del SIRE: 3 dígitos (E35)
const codigoSire = z.string().trim().regex(/^\d{3}$/, 'El código SIRE tiene 3 dígitos').nullish();
const esquemaRegimenIva = z.object({
  codigoSire, descripcion: zTexto, porcentaje: noNeg.max(100), minimoComprobante: noNeg, minimoRetencion: noNeg,
  condicionSire: z.number().int().min(0).max(99).nullish(), activo: z.boolean().optional(),
});
const esquemaRegimenSuss = z.object({ codigoSire, descripcion: zTexto, porcentaje: noNeg.max(100), minimoNoSujeto: noNeg, minimoRetencion: noNeg, activo: z.boolean().optional() });
const esquemaEscala = z.array(z.object({ desde: noNeg, hasta: noNeg.nullable(), fijo: noNeg, porcentaje: noNeg.max(100) })).min(1);
const esquemaJurisdicciones = z.array(z.object({
  jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'), alicuotaDefecto: noNeg.max(100), minimoRetencion: noNeg,
  usaPadron: z.boolean(), sinPadron: z.nativeEnum(SinPadron),
  // Percepción en ventas (E39)
  percibe: z.boolean().optional(), alicuotaPercepcionDefecto: noNeg.max(100).optional(), minimoPercepcion: noNeg.optional(), sinPadronPercepcion: z.nativeEnum(SinPadron).optional(),
}));
const esquemaRegimenExterior = z.object({
  codigoSire: z.string().trim().regex(/^\d{3}$/, 'El código SIRE tiene 3 dígitos'), descripcion: zTexto, alicuotaSinCdi: noNeg.max(100), codigoAlicuotaSinCdi: z.number().int().min(0),
  alicuotaConCdi: noNeg.max(100).nullish(), codigoAlicuotaConCdi: z.number().int().min(0).nullish(), activo: z.boolean().optional(),
});
const esquemaRegimenPercepcionIva = z.object({
  codigo: z.string().trim().regex(/^\d{1,3}$/, 'Código de régimen inválido'), descripcion: zTexto, alicuotaGeneral: noNeg.max(100), alicuotaReducida: noNeg.max(100), minimoNeto: noNeg, activo: z.boolean().optional(),
});

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

  @Get('regimenes-iva')
  @RequierePermiso()
  @RequiereAlguno('retenciones.config', 'op.crear', 'tercero.editar')
  regimenesIva() {
    return this.config.regimenesIva();
  }

  @Post('regimenes-iva')
  crearRegimenIva(@Body(new ZodValidationPipe(esquemaRegimenIva)) d: z.infer<typeof esquemaRegimenIva>) {
    return this.config.guardarRegimenIva(null, d);
  }

  @Patch('regimenes-iva/:id')
  modificarRegimenIva(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegimenIva.partial())) d: Partial<z.infer<typeof esquemaRegimenIva>>) {
    return this.config.guardarRegimenIva(id, d);
  }

  // --- Ganancias a beneficiarios del exterior (E43) ---

  @Get('regimenes-exterior')
  @RequierePermiso()
  @RequiereAlguno('retenciones.config', 'op.crear', 'tercero.editar')
  regimenesExterior() {
    return this.config.regimenesExterior();
  }

  @Post('regimenes-exterior')
  crearRegimenExterior(@Body(new ZodValidationPipe(esquemaRegimenExterior)) d: z.infer<typeof esquemaRegimenExterior>) {
    return this.config.guardarRegimenExterior(null, d);
  }

  @Patch('regimenes-exterior/:id')
  modificarRegimenExterior(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegimenExterior.partial())) d: Partial<z.infer<typeof esquemaRegimenExterior>>) {
    return this.config.guardarRegimenExterior(id, d);
  }

  // --- Régimen de percepción de IVA (E39) ---

  @Get('regimenes-percepcion-iva')
  regimenesPercepcionIva() {
    return this.config.regimenesPercepcionIva();
  }

  @Post('regimenes-percepcion-iva')
  crearRegimenPercepcionIva(@Body(new ZodValidationPipe(esquemaRegimenPercepcionIva)) d: z.infer<typeof esquemaRegimenPercepcionIva>) {
    return this.config.guardarRegimenPercepcionIva(null, d);
  }

  @Patch('regimenes-percepcion-iva/:id')
  modificarRegimenPercepcionIva(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegimenPercepcionIva.partial())) d: Partial<z.infer<typeof esquemaRegimenPercepcionIva>>) {
    return this.config.guardarRegimenPercepcionIva(id, d);
  }

  @Get('regimenes-suss')
  @RequierePermiso()
  @RequiereAlguno('retenciones.config', 'op.crear', 'tercero.editar')
  regimenesSuss() {
    return this.config.regimenesSuss();
  }

  @Post('regimenes-suss')
  crearRegimenSuss(@Body(new ZodValidationPipe(esquemaRegimenSuss)) d: z.infer<typeof esquemaRegimenSuss>) {
    return this.config.guardarRegimenSuss(null, d);
  }

  @Patch('regimenes-suss/:id')
  modificarRegimenSuss(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaRegimenSuss.partial())) d: Partial<z.infer<typeof esquemaRegimenSuss>>) {
    return this.config.guardarRegimenSuss(id, d);
  }
}
