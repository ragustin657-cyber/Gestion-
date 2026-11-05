import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { MonedasService } from './monedas.service';

const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').transform((s) => new Date(`${s}T00:00:00Z`));
const esquemaCotizacion = z.object({
  monedaCodigo: z.enum(['USD'], { message: 'Moneda inválida' }),
  fecha: zFecha,
  valor: z.number().positive('Debe ser mayor a cero'),
});

@Controller()
export class MonedasController {
  constructor(private readonly monedas: MonedasService) {}

  @Get('monedas')
  listar() {
    return this.monedas.monedas();
  }

  @Get('cotizaciones')
  cotizaciones(@Query('moneda') moneda?: string) {
    return this.monedas.listarCotizaciones(moneda);
  }

  @Get('cotizaciones/vigente')
  async vigente(@Query('moneda') moneda: string, @Query('fecha') fecha: string) {
    const f = zFecha.safeParse(fecha ?? '');
    if (!f.success) throw new BadRequestException('Fecha inválida');
    return { moneda, fecha, valor: await this.monedas.cotizacion(moneda, f.data) };
  }

  @Post('cotizaciones')
  @RequierePermiso('moneda.editar')
  crear(@Body(new ZodValidationPipe(esquemaCotizacion)) d: z.infer<typeof esquemaCotizacion>) {
    return this.monedas.crearCotizacion(d);
  }
}
