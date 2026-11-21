import { Controller, Get, Param, ParseIntPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { Columna, Fila, tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { PosicionIvaService, VistaPosicionIva } from './posicion-iva.service';

const COLUMNAS: Columna[] = [{ titulo: 'Concepto', ancho: 50 }, { titulo: 'Importe', ancho: 18, importe: true }];

/** Renglones del detalle, en el orden del F.2002 (spec E37 §9). */
export function filasPosicion(p: VistaPosicionIva): Fila[] {
  return [
    ...Object.entries(p.debito).map(([a, v]): Fila => [`Débito fiscal ${a} %`, v]), ['Total débito fiscal', p.totalDebito],
    ...Object.entries(p.credito).map(([a, v]): Fila => [`Crédito fiscal ${a} %`, v]), ['Total crédito fiscal', p.totalCredito],
    ['Saldo técnico a favor del período anterior', p.saldoTecnicoAnterior], ['Impuesto determinado', p.impuestoDeterminado], ['Saldo técnico a favor del período', p.saldoTecnicoAFavor],
    ['Retenciones de IVA sufridas', p.retenciones], ['Percepciones de IVA sufridas', p.percepciones], ['Saldo de libre disponibilidad del período anterior', p.libreAnterior],
    ['Impuesto a pagar', p.impuestoAPagar], ['Saldo de libre disponibilidad del período', p.libreDisponibilidad],
    // Prorrateo del crédito fiscal (E40)
    ...(p.coeficiente === null ? [] : [
      ['Coeficiente de prorrateo', p.coeficiente], ['Crédito fiscal de uso común', p.creditoComun!], ['Ajuste anual del prorrateo', p.ajusteProrrateo!],
      ['Crédito fiscal computable', p.creditoComputable!], ['Crédito fiscal no computable', p.creditoNoComputable!],
    ] as Fila[]),
  ];
}

@Controller('impuestos/posicion-iva')
export class PosicionIvaController {
  constructor(private readonly posicion: PosicionIvaService, private readonly tenant: TenantPrisma) {}

  @Get('meses') @RequierePermiso('impuestos.ver')
  meses(@Query('anio', ParseIntPipe) anio: number) {
    return this.posicion.meses(anio);
  }

  @Get() @RequierePermiso('impuestos.ver')
  async ver(@Query('anio', ParseIntPipe) anio: number, @Query('mes', ParseIntPipe) mes: number, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const p = await this.posicion.ver(anio, mes);
    if (formato !== 'xlsx' && formato !== 'pdf') return p;
    const periodo = `${String(mes).padStart(2, '0')}/${anio}`;
    const titulo = 'Posición de IVA', sub = `Período ${periodo}${p.estado === 'CERRADA' ? ' (cerrada)' : ' (borrador)'}`;
    const nombre = `posicion-iva-${anio}${String(mes).padStart(2, '0')}`;
    if (formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, sub, COLUMNAS, filasPosicion(p)));
    }
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
    return new StreamableFile(await tablaPdf(empresa.razonSocial, titulo, sub, COLUMNAS, filasPosicion(p)));
  }

  @Post(':anio/:mes/cerrar') @RequierePermiso('impuestos.presentar')
  cerrar(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.posicion.cerrar(anio, mes);
  }

  @Post(':anio/:mes/reabrir') @RequierePermiso('impuestos.presentar')
  reabrir(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.posicion.reabrir(anio, mes);
  }
}
