import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { Columna, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { DatosCargados, DjGananciasService, Tramo } from './dj-ganancias.service';

const uuid = z.string().uuid('Valor inválido');
const imp = z.number().min(0, 'No puede ser negativo');
const esquemaDatos = z.object({ ejercicioId: uuid, quebrantosAnteriores: imp, anticiposIngresados: imp, saldoAFavorAnterior: imp, impuestoCheque: imp, otrosPagos: imp });
const esquemaAjuste = z.object({ ejercicioId: uuid, concepto: z.string().trim().min(1, 'Requerido').max(200), importe: z.number().refine((x) => x !== 0, 'El importe no puede ser cero') });
const esquemaEscala = z.object({ tramos: z.array(z.object({ desde: z.number().min(0), fijo: z.number().min(0), alicuota: z.number().min(0).max(100) })).min(1) });

@Controller('impuestos')
export class DjGananciasController {
  constructor(private readonly dj: DjGananciasService) {}

  @Get('escala-sociedades/:anio')
  @RequierePermiso('impuestos.ver')
  escala(@Param('anio', ParseIntPipe) anio: number) {
    return this.dj.escala(anio);
  }

  @Put('escala-sociedades/:anio')
  @RequierePermiso('impuestos.presentar')
  guardarEscala(@Param('anio', ParseIntPipe) anio: number, @Body(new ZodValidationPipe(esquemaEscala)) b: { tramos: Tramo[] }) {
    return this.dj.guardarEscala(anio, b.tramos);
  }

  @Get('dj-ganancias')
  @RequierePermiso('impuestos.ver')
  async consultar(@Query() q: { ejercicioId?: string; formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.dj.consultar(q);
    if (q.formato !== 'xlsx') return r;
    const d = r.determinacion;
    const columnas: Columna[] = [{ titulo: 'Concepto', ancho: 220 }, { titulo: 'Importe', ancho: 90, importe: true }];
    const filas: (string | null)[][] = [
      ['Resultado contable (sin ajuste por inflación contable)', d.resultadoContable], ['Ajuste de amortizaciones', d.ajusteAmortizaciones], ['Ajuste por inflación impositivo', d.ajusteInflacion],
      ...r.ajustes.map((a) => [`Ajuste manual: ${a.concepto}`, a.importe]), ['Resultado impositivo', d.resultadoImpositivo], ['Quebrantos computados', d.quebrantosComputados],
      ['Quebranto del ejercicio', d.quebrantoEjercicio], ['Ganancia neta imponible', d.gananciaNetaImponible], ['Impuesto determinado', d.impuestoDeterminado],
      ['Retenciones', d.retenciones], ['Percepciones', d.percepciones], ['Anticipos ingresados', r.datos.anticiposIngresados], ['Saldo a favor anterior', r.datos.saldoAFavorAnterior],
      ['Impuesto sobre débitos y créditos', r.datos.impuestoCheque], ['Otros pagos a cuenta', r.datos.otrosPagos], ['Pagos a cuenta', d.pagosACuenta], ['Saldo (a pagar + / a favor −)', d.saldo],
      ['Base de los anticipos', d.baseAnticipos], ...d.anticipos.map((a) => [`Anticipo ${a.numero} (${a.mes.slice(5, 7)}/${a.mes.slice(0, 4)})`, a.importe]),
    ];
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="dj-ganancias-${r.ejercicio.hasta}.xlsx"` });
    return new StreamableFile(await tablaXlsx('DJ de Ganancias de sociedades', `Ejercicio ${r.ejercicio.numero} (${r.ejercicio.desde} a ${r.ejercicio.hasta}) · ${r.estado === 'PRESENTADA' ? 'presentada' : 'borrador'}`, columnas, filas as never));
  }

  @Put('dj-ganancias/datos')
  @RequierePermiso('impuestos.presentar')
  guardarDatos(@Body(new ZodValidationPipe(esquemaDatos)) d: DatosCargados) {
    return this.dj.guardarDatos(d);
  }

  @Post('dj-ganancias/ajustes')
  @RequierePermiso('impuestos.presentar')
  crearAjuste(@Body(new ZodValidationPipe(esquemaAjuste)) d: z.infer<typeof esquemaAjuste>) {
    return this.dj.guardarAjuste(null, d);
  }

  @Put('dj-ganancias/ajustes/:id')
  @RequierePermiso('impuestos.presentar')
  modificarAjuste(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaAjuste)) d: z.infer<typeof esquemaAjuste>) {
    return this.dj.guardarAjuste(id, d);
  }

  @Delete('dj-ganancias/ajustes/:id')
  @RequierePermiso('impuestos.presentar')
  eliminarAjuste(@Param('id', ParseUUIDPipe) id: string) {
    return this.dj.eliminarAjuste(id);
  }

  @Post('dj-ganancias/presentar') @HttpCode(200)
  @RequierePermiso('impuestos.presentar')
  presentar(@Body(new ZodValidationPipe(z.object({ ejercicioId: uuid }))) b: { ejercicioId: string }) {
    return this.dj.presentar(b.ejercicioId);
  }

  @Post('dj-ganancias/anular') @HttpCode(200)
  @RequierePermiso('impuestos.presentar')
  anular(@Body(new ZodValidationPipe(z.object({ ejercicioId: uuid, motivo: z.string().trim().min(1, 'Indique el motivo').max(200) }))) b: { ejercicioId: string; motivo: string }) {
    return this.dj.anular(b.ejercicioId, b.motivo);
  }
}
