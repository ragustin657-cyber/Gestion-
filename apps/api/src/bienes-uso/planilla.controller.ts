import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { ConsultasContablesService } from '../contabilidad/consultas/consultas.service';
import { Columna, tablaPdf, tablaXlsx } from '../contabilidad/consultas/exportar';
import { PlanillaService } from './planilla.service';

const fAR = (s: string) => s.split('-').reverse().join('/');

@Controller('bienes-uso/planilla')
export class PlanillaController {
  constructor(private readonly planillas: PlanillaService, private readonly contables: ConsultasContablesService) {}

  @Get()
  @RequierePermiso('bienes.ver')
  async planilla(@Query() q: { ejercicioId?: string; fecha?: string; reexpresar?: string; formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.planillas.planilla(q);
    if (!q.formato) return r;
    const imp = (titulo: string): Columna => ({ titulo, ancho: 72, importe: true });
    const columnas: Columna[] = [{ titulo: 'Rubro', ancho: 120 }, imp('Origen al inicio'), imp('Altas'), imp('Bajas'), imp('Origen al cierre'), imp('Amort. al inicio'), imp('Amort. bajas'), imp('Amort. del ejercicio'), imp('Amort. al cierre'), imp('Neto')];
    const fila = (n: string, x: typeof r.totales) => [n, x.origenInicio, x.altas, x.bajas, x.origenCierre, x.amortInicio, x.amortBajas, x.amortEjercicio, x.amortCierre, x.neto];
    const filas = [...r.filas.map((f) => fila(f.rubro, f)), fila('Total', r.totales)];
    const titulo = 'Planilla anexa de bienes de uso';
    const subtitulo = `Ejercicio ${r.ejercicio.numero} al ${fAR(r.fecha)}${q.reexpresar === 'true' && !r.aviso ? ' · en moneda de cierre' : ''}${r.aviso ? ` · ${r.aviso}` : ''}`;
    const nombre = `planilla-bienes-${r.fecha}`;
    if (q.formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, subtitulo, columnas, filas));
    }
    if (q.formato === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
      return new StreamableFile(await tablaPdf((await this.contables.empresa()).razonSocial, titulo, subtitulo, columnas, filas));
    }
    throw new BadRequestException('Formato inválido: use xlsx o pdf');
  }
}
