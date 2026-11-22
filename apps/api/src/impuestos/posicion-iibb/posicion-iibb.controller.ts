import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { nombreJurisdiccion } from '@gestion/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { Columna, Fila, tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { DatosJurisdiccionCm, PosicionIibbService, VistaPosicionIibb } from './posicion-iibb.service';

const esquemaJurisdicciones = z.object({
  jurisdicciones: z.array(z.object({
    jurisdiccion: z.string().regex(/^9\d\d$/, 'Jurisdicción inválida'),
    coeficiente: z.number().min(0, 'El coeficiente va de 0 a 1').max(1, 'El coeficiente va de 0 a 1'),
    alicuota: z.number().min(0, 'La alícuota va de 0 a 100').max(100, 'La alícuota va de 0 a 100'),
    actividad: z.string().trim().min(1, 'Indique la actividad'),
    saldoInicial: z.number().min(0, 'No puede ser negativo').optional(),
  })),
});

const COLUMNAS: Columna[] = [
  { titulo: 'Jurisdicción', ancho: 24 }, { titulo: 'Coeficiente', ancho: 12 }, { titulo: 'Base', ancho: 16, importe: true }, { titulo: 'Alícuota %', ancho: 10 },
  { titulo: 'Impuesto', ancho: 14, importe: true }, { titulo: 'Retenciones', ancho: 14, importe: true }, { titulo: 'Percepciones', ancho: 14, importe: true },
  { titulo: 'Saldo anterior', ancho: 14, importe: true }, { titulo: 'A pagar', ancho: 14, importe: true }, { titulo: 'Saldo a favor', ancho: 14, importe: true },
];

export function filasPosicionIibb(p: VistaPosicionIibb): Fila[] {
  const t = p.totales;
  return [
    ...p.detalle.map((d): Fila => [nombreJurisdiccion(d.jurisdiccion), d.coeficiente, d.base, d.alicuota, d.impuesto, d.retenciones, d.percepciones, d.saldoAnterior, d.aPagar, d.saldoAFavor]),
    ['Total', '', t.base, '', t.impuesto, t.retenciones, t.percepciones, t.saldoAnterior, t.aPagar, t.saldoAFavor],
  ];
}

@Controller('impuestos/iibb')
export class PosicionIibbController {
  constructor(private readonly posicion: PosicionIibbService, private readonly tenant: TenantPrisma) {}

  @Get('jurisdicciones') @RequierePermiso('impuestos.ver')
  jurisdicciones(@Query('anio', ParseIntPipe) anio: number) {
    return this.posicion.jurisdicciones(anio);
  }

  @Put('jurisdicciones') @RequierePermiso('impuestos.presentar')
  guardarJurisdicciones(@Query('anio', ParseIntPipe) anio: number, @Body(new ZodValidationPipe(esquemaJurisdicciones)) d: { jurisdicciones: DatosJurisdiccionCm[] }) {
    return this.posicion.guardarJurisdicciones(anio, d.jurisdicciones);
  }

  @Get('ingresos-por-provincia') @RequierePermiso('impuestos.ver')
  async ingresosPorProvincia(@Query('anio', ParseIntPipe) anio: number, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const r = await this.posicion.ingresosPorProvincia(anio);
    if (formato !== 'xlsx' && formato !== 'pdf') return r;
    const columnas: Columna[] = [{ titulo: 'Jurisdicción', ancho: 30 }, { titulo: 'Ingresos', ancho: 18, importe: true }, { titulo: '% del total', ancho: 12 }];
    const filas: Fila[] = [...r.filas.map((f): Fila => [f.nombre, f.ingresos, f.porcentaje]), ['Total', r.total, r.porcentajeTotal]];
    const titulo = 'Ingresos por provincia', sub = `Año ${anio}`, nombre = `ingresos-por-provincia-${anio}`;
    if (formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, sub, columnas, filas));
    }
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
    return new StreamableFile(await tablaPdf(empresa.razonSocial, titulo, sub, columnas, filas));
  }

  @Get('posicion/meses') @RequierePermiso('impuestos.ver')
  meses(@Query('anio', ParseIntPipe) anio: number) {
    return this.posicion.meses(anio);
  }

  @Get('posicion') @RequierePermiso('impuestos.ver')
  async ver(@Query('anio', ParseIntPipe) anio: number, @Query('mes', ParseIntPipe) mes: number, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const p = await this.posicion.ver(anio, mes);
    if (formato !== 'xlsx' && formato !== 'pdf') return p;
    const titulo = 'Liquidación de IIBB (Convenio Multilateral)';
    const sub = `Período ${String(mes).padStart(2, '0')}/${anio} — ingresos ${p.ingresos}${p.estado === 'CERRADA' ? ' (cerrada)' : ' (borrador)'}`;
    const nombre = `iibb-cm-${anio}${String(mes).padStart(2, '0')}`;
    if (formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, sub, COLUMNAS, filasPosicionIibb(p)));
    }
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
    return new StreamableFile(await tablaPdf(empresa.razonSocial, titulo, sub, COLUMNAS, filasPosicionIibb(p)));
  }

  @Post('posicion/:anio/:mes/cerrar') @RequierePermiso('impuestos.presentar')
  cerrar(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.posicion.cerrar(anio, mes);
  }

  @Post('posicion/:anio/:mes/reabrir') @RequierePermiso('impuestos.presentar')
  reabrir(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.posicion.reabrir(anio, mes);
  }
}
