import { JURISDICCIONES_CM } from '@gestion/shared';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosRecaudacion, SircrebService } from './sircreb.service';

const esquema = z.object({
  periodo: z.string().regex(/^\d{4}(0[1-9]|1[0-2])$/, 'Período inválido (AAAAMM)'),
  jurisdiccion: z.string().refine((j) => j in JURISDICCIONES_CM, 'Jurisdicción inválida'),
  importe: z.number().min(0, 'No puede ser negativo'),
  cuentaBancariaId: z.string().uuid().nullish(), cbu: z.string().trim().max(30).nullish(), referencia: z.string().trim().max(200).nullish(),
});

@Controller('impuestos/recaudaciones-bancarias')
export class SircrebController {
  constructor(private readonly sircreb: SircrebService) {}

  @Get()
  @RequierePermiso('impuestos.ver')
  listar(@Query('periodo') periodo?: string) {
    return this.sircreb.listar(periodo);
  }

  @Post()
  @RequierePermiso('impuestos.presentar')
  crear(@Body(new ZodValidationPipe(esquema)) d: DatosRecaudacion) {
    return this.sircreb.guardar(null, d);
  }

  @Post('importar')
  @RequierePermiso('impuestos.presentar')
  importar(@Body(new ZodValidationPipe(z.object({ texto: z.string().max(2_000_000) }))) b: { texto: string }) {
    return this.sircreb.importar(b.texto);
  }

  @Put(':id')
  @RequierePermiso('impuestos.presentar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquema)) d: DatosRecaudacion) {
    return this.sircreb.guardar(id, d);
  }

  @Delete(':id')
  @RequierePermiso('impuestos.presentar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.sircreb.eliminar(id);
  }
}
