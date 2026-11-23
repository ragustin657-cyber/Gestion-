import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { Columna, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { BienesPersonalesService, DatosSocio } from './bienes-personales.service';

const TIPOS = ['PERSONA_HUMANA_PAIS', 'PERSONA_HUMANA_EXTERIOR', 'SUCESION_INDIVISA', 'SOCIEDAD_EXTERIOR', 'SOCIEDAD_PAIS'] as const;
const NOMBRE_TIPO: Record<string, string> = {
  PERSONA_HUMANA_PAIS: 'Persona humana del país', PERSONA_HUMANA_EXTERIOR: 'Persona humana del exterior', SUCESION_INDIVISA: 'Sucesión indivisa',
  SOCIEDAD_EXTERIOR: 'Sociedad del exterior', SOCIEDAD_PAIS: 'Sociedad del país (no paga)',
};
const pct = z.number().min(0).max(100).refine((x) => Math.round(x * 10000) === x * 10000 || Math.abs(Math.round(x * 10000) - x * 10000) < 1e-6, 'Hasta 4 decimales');
const esquemaSocio = z.object({
  nombre: z.string().trim().min(1, 'Requerido').max(200), tipoDocumento: z.string().trim().min(1).max(20), documento: z.string().trim().min(1, 'Requerido').max(30),
  tipoTitular: z.enum(TIPOS, { message: 'Tipo inválido' }), porcentaje: pct, activo: z.boolean().optional(),
});
const anio = z.number().int().min(2000).max(2100);

@Controller('impuestos')
export class BienesPersonalesController {
  constructor(private readonly bp: BienesPersonalesService) {}

  @Get('socios')
  @RequierePermiso('impuestos.ver')
  socios() {
    return this.bp.socios();
  }

  @Post('socios')
  @RequierePermiso('impuestos.presentar')
  crearSocio(@Body(new ZodValidationPipe(esquemaSocio)) d: DatosSocio) {
    return this.bp.guardarSocio(null, d);
  }

  @Put('socios/:id')
  @RequierePermiso('impuestos.presentar')
  modificarSocio(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaSocio)) d: DatosSocio) {
    return this.bp.guardarSocio(id, d);
  }

  /** Revisión E47: el ABM de la web edita con PATCH (dos decoradores en un mismo método registran solo uno). */
  @Patch('socios/:id')
  @RequierePermiso('impuestos.presentar')
  modificarSocioPatch(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaSocio)) d: DatosSocio) {
    return this.bp.guardarSocio(id, d);
  }

  @Get('bienes-personales')
  @RequierePermiso('impuestos.ver')
  async consultar(@Query() q: { anio?: string; formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.bp.consultar(q);
    if (q.formato !== 'xlsx') return r;
    const l = r.liquidacion;
    const columnas: Columna[] = [{ titulo: 'Socio', ancho: 160 }, { titulo: 'Documento', ancho: 80 }, { titulo: 'Tipo', ancho: 120 }, { titulo: 'Participación %', ancho: 60 }, { titulo: 'Valor patrimonial proporcional', ancho: 100, importe: true }, { titulo: 'Impuesto', ancho: 80, importe: true }];
    const filas = [
      ...l.filas.map((f) => [f.nombre, f.documento, NOMBRE_TIPO[f.tipoTitular], f.porcentaje, f.vpp, f.impuesto]),
      ['Total', '', '', l.sumaParticipaciones, l.base, l.total],
    ];
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="bienes-personales-${r.anio}.xlsx"` });
    const sub = `Año ${r.anio} · balance al ${r.ejercicio.hasta} · patrimonio ${l.patrimonio}, ajuste ${l.ajuste} · alícuota ${l.alicuota} %${l.avisos.length ? ` · ${l.avisos.join(' · ')}` : ''}`;
    return new StreamableFile(await tablaXlsx('Bienes Personales - acciones y participaciones', sub, columnas, filas as never));
  }

  @Put('bienes-personales/ajuste')
  @RequierePermiso('impuestos.presentar')
  ajuste(@Body(new ZodValidationPipe(z.object({ anio, importe: z.number().refine((x) => Math.abs(x) < 1e16, 'Importe inválido').refine((x) => Math.abs(Math.round(x * 100) - x * 100) < 1e-6, 'Hasta 2 decimales'), concepto: z.string().trim().max(200).nullish() }))) d: { anio: number; importe: number; concepto?: string | null }) {
    return this.bp.guardarAjuste(d);
  }

  @Put('bienes-personales/participaciones')
  @RequierePermiso('impuestos.presentar')
  participaciones(@Body(new ZodValidationPipe(z.object({ anio, participaciones: z.array(z.object({ socioId: z.string().uuid('Valor inválido'), tipoTitular: z.enum(TIPOS), porcentaje: pct })) }))) d: { anio: number; participaciones: { socioId: string; tipoTitular: (typeof TIPOS)[number]; porcentaje: number }[] }) {
    return this.bp.guardarParticipaciones(d);
  }

  @Post('bienes-personales/copiar-socios') @HttpCode(200)
  @RequierePermiso('impuestos.presentar')
  copiar(@Body(new ZodValidationPipe(z.object({ anio }))) b: { anio: number }) {
    return this.bp.copiarSocios(b.anio);
  }

  @Post('bienes-personales/presentar') @HttpCode(200)
  @RequierePermiso('impuestos.presentar')
  presentar(@Body(new ZodValidationPipe(z.object({ anio }))) b: { anio: number }) {
    return this.bp.presentar(b.anio);
  }

  @Post('bienes-personales/anular') @HttpCode(200)
  @RequierePermiso('impuestos.presentar')
  anular(@Body(new ZodValidationPipe(z.object({ anio, motivo: z.string().trim().min(1, 'Indique el motivo').max(200) }))) b: { anio: number; motivo: string }) {
    return this.bp.anular(b.anio, b.motivo);
  }
}
