import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { DatosLiquidacion, DatosTarjeta, TarjetasService } from './tarjetas.service';

const esquemaTarjeta = z.object({
  nombre: z.string().trim().min(1).max(60), tipo: z.enum(['CREDITO', 'DEBITO', 'QR']), cuentaBancariaId: z.string().uuid(),
  cuentaContableId: z.string().uuid().nullish(), activa: z.boolean().optional(),
});

const zImporte = z.number().finite();
const esquemaLiquidacion = z.object({
  tarjetaId: z.string().uuid(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'), referencia: z.string().trim().max(60).nullish(), cuponIds: z.array(z.string().uuid()).min(1, 'Elija al menos un cupón'),
  arancel: zImporte, ivaArancel: zImporte, costoFinanciero: zImporte.optional(), ivaCostoFinanciero: zImporte.optional(),
  impuestos: z.array(z.object({ clase: z.enum(['RETENCION', 'PERCEPCION']), tipo: z.enum(['IVA', 'GANANCIAS', 'IIBB']), jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida').nullish(), importe: zImporte })).default([]),
  neto: zImporte, cuentaBancariaId: z.string().uuid().nullish(),
});

@Controller('tesoreria')
export class TarjetasController {
  constructor(private readonly t: TarjetasService) {}

  @Get('tarjetas') @RequierePermiso()
  listar() { return this.t.listar(); }

  @Get('cupones') @RequierePermiso('tesoreria.ver')
  cupones(@Query() q: { tarjetaId?: string; estado?: string; desde?: string; hasta?: string }) { return this.t.cupones(q); }

  @Get('tarjetas/costo') @RequierePermiso('tesoreria.ver')
  async costo(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const filas = await this.t.costo(desde, hasta);
    if (!formato) return filas;
    const fAR = (s: string) => s.split('-').reverse().join('/');
    const columnas = [{ titulo: 'Tarjeta', ancho: 160 }, { titulo: 'Bruto', ancho: 90, importe: true }, { titulo: 'Comisiones', ancho: 90, importe: true }, { titulo: 'IVA', ancho: 80, importe: true },
      { titulo: 'Ret. y percep.', ancho: 90, importe: true }, { titulo: 'Neto', ancho: 90, importe: true }, { titulo: 'Costo %', ancho: 60, importe: true }, { titulo: 'Desc. total %', ancho: 70, importe: true }];
    const datos = filas.map((f) => [f.tarjeta, f.bruto, f.comisiones, f.iva, f.impuestos, f.neto, f.costoPct, f.descuentoTotalPct]);
    const titulo = 'Costo por tarjeta';
    const subtitulo = `${fAR(desde)} al ${fAR(hasta)}`;
    const nombre = `costo-tarjetas-${desde}-${hasta}`;
    if (formato === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
      return new StreamableFile(await tablaXlsx(titulo, subtitulo, columnas, datos));
    }
    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
      return new StreamableFile(await tablaPdf(await this.t.razonSocial(), titulo, subtitulo, columnas, datos));
    }
    throw new BadRequestException('Formato inválido: use xlsx o pdf');
  }

  @Get('liquidaciones-tarjeta') @RequierePermiso('tesoreria.ver')
  liquidaciones(@Query() q: { tarjetaId?: string; desde?: string; hasta?: string }) { return this.t.liquidaciones(q); }

  @Get('liquidaciones-tarjeta/:id') @RequierePermiso('tesoreria.ver')
  liquidacion(@Param('id', ParseUUIDPipe) id: string) { return this.t.obtenerLiquidacion(id); }

  @Post('liquidaciones-tarjeta') @RequierePermiso('tesoreria.tarjetas')
  liquidar(@Body(new ZodValidationPipe(esquemaLiquidacion)) d: DatosLiquidacion) { return this.t.liquidar(d); }

  @Post('liquidaciones-tarjeta/:id/anular') @RequierePermiso('tesoreria.tarjetas')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ motivo: z.string().trim().min(1, 'Indique el motivo').max(200) }))) d: { motivo: string }) { return this.t.anularLiquidacion(id, d.motivo); }

  @Post('tarjetas') @RequierePermiso('tesoreria.maestros.editar')
  crear(@Body(new ZodValidationPipe(esquemaTarjeta)) d: DatosTarjeta) { return this.t.crear(d); }

  @Put('tarjetas/:id') @RequierePermiso('tesoreria.maestros.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaTarjeta)) d: DatosTarjeta) { return this.t.modificar(id, d); }
}
