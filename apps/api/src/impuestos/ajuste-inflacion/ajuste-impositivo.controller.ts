import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { Columna, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { AjusteImpositivoService, DatosPartida } from './ajuste-impositivo.service';

const esquemaPartida = z.object({
  ejercicioId: z.string().uuid('Valor inválido'),
  concepto: z.string().trim().min(1, 'Requerido').max(200),
  tipo: z.enum(['ACTIVO_INICIO', 'PASIVO_INICIO', 'DINAMICO'], { message: 'Tipo inválido' }),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').transform((s) => new Date(`${s}T00:00:00Z`)).nullish(),
  importe: z.number().refine((x) => x !== 0, 'El importe no puede ser cero'),
}).refine((d) => d.tipo !== 'DINAMICO' || !!d.fecha, { message: 'Indique la fecha de la partida dinámica', path: ['fecha'] });

const NOMBRE_TIPO: Record<string, string> = { APORTE: 'Aporte', RETIRO: 'Retiro', COMPRA_EXCLUIDO: 'Compra de bien excluido', VENTA_EXCLUIDO: 'Venta de bien excluido', MANUAL: 'Partida manual' };

@Controller('impuestos/ajuste-inflacion')
export class AjusteImpositivoController {
  constructor(private readonly ajuste: AjusteImpositivoService) {}

  @Get()
  @RequierePermiso('impuestos.ver')
  async planilla(@Query() q: { ejercicioId?: string; formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.ajuste.planilla(q);
    if (q.formato !== 'xlsx') return r;
    const columnas: Columna[] = [{ titulo: 'Concepto', ancho: 200 }, { titulo: 'Fecha', ancho: 60 }, { titulo: 'Asiento', ancho: 40 }, { titulo: 'Importe', ancho: 80, importe: true }, { titulo: 'Coeficiente', ancho: 60 }, { titulo: 'Ajuste', ancho: 80, importe: true }];
    const filas: (string | number | null)[][] = [
      ...r.estatico.cuentas.map((c) => [`${c.codigo} ${c.nombre}`, '', '', c.saldo, '', '']),
      ['Activo computable', '', '', r.estatico.activo, '', ''], ['Pasivo computable', '', '', r.estatico.pasivo, '', ''],
      ['Partidas manuales de activo', '', '', r.estatico.manualActivo, '', ''], ['Partidas manuales de pasivo', '', '', r.estatico.manualPasivo, '', ''],
      ['Ajuste estático', '', '', r.estatico.base, r.estatico.coeficiente, r.estatico.ajuste],
      ...r.dinamico.movimientos.map((m) => [`${NOMBRE_TIPO[m.tipo]}: ${m.descripcion}`, m.fecha, m.asientoNumero ?? '', m.importe, m.coeficiente, m.ajuste]),
      ['Ajuste dinámico', '', '', '', '', r.dinamico.total], ['Total del ajuste', '', '', '', '', r.total], ['Total para la DJ', '', '', '', '', r.totalDj],
    ];
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="ajuste-impositivo-${r.ejercicio.hasta}.xlsx"` });
    const sub = `Ejercicio ${r.ejercicio.numero} (${r.ejercicio.desde} a ${r.ejercicio.hasta}) · variación de 36 meses ${r.variacion36} %${r.aviso ? ` · ${r.aviso}` : ''}`;
    return new StreamableFile(await tablaXlsx('Ajuste por inflación impositivo', sub, columnas, filas as never));
  }

  @Get('partidas')
  @RequierePermiso('impuestos.ver')
  partidas(@Query('ejercicioId') ejercicioId?: string) {
    return this.ajuste.partidas(ejercicioId);
  }

  @Post('partidas')
  @RequierePermiso('impuestos.presentar')
  crear(@Body(new ZodValidationPipe(esquemaPartida)) d: DatosPartida) {
    return this.ajuste.guardarPartida(null, d);
  }

  @Put('partidas/:id')
  @RequierePermiso('impuestos.presentar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaPartida)) d: DatosPartida) {
    return this.ajuste.guardarPartida(id, d);
  }

  @Delete('partidas/:id')
  @RequierePermiso('impuestos.presentar')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.ajuste.eliminarPartida(id);
  }
}
