import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ConsultasContablesService } from '../contabilidad/consultas/consultas.service';
import { Columna, Fila, tablaPdf, tablaXlsx } from '../contabilidad/consultas/exportar';
import { InformesService } from './informes.service';

type Q = Record<string, string | undefined>;
const fAR = (s?: string) => (s ? s.split('-').reverse().join('/') : '');

@Controller('informes')
@RequierePermiso('informes.ver')
export class InformesController {
  constructor(
    private readonly informes: InformesService,
    private readonly contables: ConsultasContablesService,
  ) {}

  /** Excel o PDF de una tabla de informe. */
  async salida(formato: string, res: Response, nombre: string, titulo: string, subtitulo: string, columnas: Columna[], filas: Fila[]) {
    if (formato === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
      return new StreamableFile(await tablaXlsx(titulo, subtitulo, columnas, filas));
    }
    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
      return new StreamableFile(await tablaPdf((await this.contables.empresa()).razonSocial, titulo, subtitulo, columnas, filas));
    }
    throw new BadRequestException('Formato inválido: use xlsx o pdf');
  }

  private columnasVentas(nombre: string): Columna[] {
    return [{ titulo: nombre, ancho: 260 }, { titulo: 'Ventas', ancho: 100, importe: true }, { titulo: 'Costo', ancho: 100, importe: true }, { titulo: 'Margen', ancho: 100, importe: true }, { titulo: 'Margen %', ancho: 70, importe: true }, { titulo: 'Sin costo', ancho: 100, importe: true }];
  }

  @Get('ventas')
  async ventas(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const r = await this.informes.ventas(q);
    if (!q.formato) return r;
    const t = r.totales;
    return this.salida(q.formato, res, `ventas-${q.desde}-${q.hasta}`, `Ventas por ${q.agrupar ?? 'cliente'}`, `${fAR(q.desde)} al ${fAR(q.hasta)}${r.aviso ? ` · ${r.aviso}` : ''}`, this.columnasVentas(q.agrupar === 'articulo' ? 'Artículo' : q.agrupar === 'mes' ? 'Mes' : 'Cliente'),
      [...r.filas.map((f) => [f.nombre, f.ventas, f.costo, f.margen, f.margenPct, f.sinCosto]), ['Total', t.ventas, t.costo, t.margen, t.margenPct, t.sinCosto]]);
  }

  @Get('margenes')
  async margenes(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const r = await this.informes.margenes(q);
    if (!q.formato) return r;
    const t = r.totales;
    return this.salida(q.formato, res, `margenes-${q.desde}-${q.hasta}`, 'Márgenes', `${fAR(q.desde)} al ${fAR(q.hasta)} · Cobertura ${t.cobertura ?? '—'} %`, this.columnasVentas(q.agrupar === 'cliente' ? 'Cliente' : 'Artículo'),
      [...r.filas.map((f) => [f.nombre, f.ventas, f.costo, f.margen, f.margenPct, f.sinCosto]), ['Total', t.ventas, t.costo, t.margen, t.margenPct, t.sinCosto]]);
  }
}
