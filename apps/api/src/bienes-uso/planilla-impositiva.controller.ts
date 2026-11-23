import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { Columna, tablaXlsx } from '../contabilidad/consultas/exportar';
import { PlanillaImpositivaService } from './planilla-impositiva.service';

@Controller('bienes-uso/planilla-impositiva')
export class PlanillaImpositivaController {
  constructor(private readonly planillas: PlanillaImpositivaService) {}

  @Get()
  @RequierePermiso('bienes.ver')
  async planilla(@Query() q: { ejercicioId?: string; formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.planillas.planilla(q);
    if (!q.formato) return r;
    if (q.formato !== 'xlsx') throw new BadRequestException('Formato inválido: use xlsx');
    const imp = (titulo: string): Columna => ({ titulo, ancho: 72, importe: true });
    const columnas: Columna[] = [
      { titulo: 'Bien', ancho: 140 }, { titulo: 'Alta', ancho: 60 }, { titulo: 'Baja', ancho: 60 }, { titulo: 'Vida (años)', ancho: 40 }, imp('Valor de origen'), { titulo: 'Coeficiente', ancho: 50 },
      imp('Valor actualizado'), imp('Acumulada anterior'), imp('Cuota del ejercicio'), imp('No deducible'), imp('Deducible'), imp('Acumulada al cierre'), imp('Valor residual'), imp('Costo computable de la baja'), imp('Contable del ejercicio'), imp('Diferencia'),
    ];
    const filas: (string | number | null)[][] = [];
    for (const g of r.filas) {
      for (const b of g.bienes)
        filas.push([`${b.numero} ${b.descripcion}`, b.fechaAlta, b.fechaBaja ?? '', b.vidaUtilAnios, b.valorOrigen, b.coeficiente, b.valorActualizado, b.acumuladaAnterior, b.cuota, b.noDeducible, (Number(b.cuota) - Number(b.noDeducible)).toFixed(2), b.acumuladaCierre, b.valorResidual, b.costoComputableBaja ?? '', b.contable, b.diferencia]);
      filas.push([`Subtotal ${g.rubro}`, '', '', '', '', '', '', '', g.subtotal.cuota, g.subtotal.noDeducible, g.subtotal.deducible, '', g.subtotal.valorResidual, '', g.subtotal.contable, g.subtotal.diferencia]);
    }
    filas.push(['Total', '', '', '', '', '', '', '', r.totales.cuota, r.totales.noDeducible, r.totales.deducible, '', r.totales.valorResidual, '', r.totales.contable, r.totales.diferencia]);
    const nombre = `amortizacion-impositiva-${r.ejercicio.hasta}`;
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
    return new StreamableFile(await tablaXlsx('Amortización impositiva de bienes de uso', `Ejercicio ${r.ejercicio.numero} (${r.ejercicio.desde} a ${r.ejercicio.hasta})${r.avisos.length ? ` · ${r.avisos.join(' · ')}` : ''}`, columnas, filas as never));
  }
}
