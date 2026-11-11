import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasContablesService } from '../../contabilidad/consultas/consultas.service';
import { Columna, Fila, tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { ConsultasStockService } from './consultas-stock.service';

type Q = Record<string, string | undefined>;
const fAR = (s: string) => s.split('-').reverse().join('/');

@Controller('stock')
@RequierePermiso('stock.ver')
export class ConsultasStockController {
  constructor(
    private readonly consultas: ConsultasStockService,
    private readonly contables: ConsultasContablesService,
  ) {}

  private async salida(formato: string | undefined, res: Response, nombre: string, titulo: string, subtitulo: string, columnas: Columna[], filas: Fila[]) {
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

  @Get('existencias')
  async existencias(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const r = await this.consultas.existencias(q);
    if (!q.formato) return r;
    return this.salida(q.formato, res, 'existencias', 'Existencias', 'Stock por depósito y valuación al costo promedio', [
      { titulo: 'Código', ancho: 90 }, { titulo: 'Artículo', ancho: 230 }, { titulo: 'Depósitos', ancho: 200 }, { titulo: 'Cantidad', ancho: 80, importe: true },
      { titulo: 'Costo promedio', ancho: 90, importe: true }, { titulo: 'Valor', ancho: 100, importe: true },
    ], [...r.filas.map((f) => [f.codigo, f.descripcion, f.depositos.map((d) => `${d.nombre}: ${d.cantidad}`).join(' · '), f.cantidad, f.costoPromedio, f.valor]), ['', 'Total', '', null, null, r.total]]);
  }

  @Get('kardex')
  async kardex(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const k = await this.consultas.kardex(q);
    if (!q.formato) return k;
    return this.salida(q.formato, res, `kardex-${k.articulo.codigo}`, `Kardex ${k.articulo.codigo} ${k.articulo.descripcion}`, q.desde || q.hasta ? `${q.desde ? fAR(q.desde) : ''} al ${q.hasta ? fAR(q.hasta) : ''}` : 'Todos los movimientos', [
      { titulo: 'Fecha', ancho: 70 }, { titulo: 'Documento', ancho: 180 }, { titulo: 'Entrada', ancho: 70, importe: true }, { titulo: 'Salida', ancho: 70, importe: true },
      { titulo: 'Saldo', ancho: 70, importe: true }, { titulo: 'Costo unitario', ancho: 90, importe: true }, { titulo: 'Importe', ancho: 90, importe: true }, { titulo: 'Saldo valor', ancho: 100, importe: true },
    ], [['', 'Saldo inicial', null, null, k.saldoInicial.cantidad, null, null, k.saldoInicial.valor], ...k.movimientos.map((m) => [fAR(m.fecha), m.documento, m.entrada, m.salida, m.saldoCantidad, m.costoUnitario, m.importe, m.saldoValor])]);
  }

  @Get('valuacion')
  async valuacion(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const v = await this.consultas.valuacion(q);
    if (!q.formato) return v;
    return this.salida(q.formato, res, `valuacion-${v.fecha}`, 'Valuación de inventario', `Al ${fAR(v.fecha)}`, [
      { titulo: 'Código', ancho: 100 }, { titulo: 'Artículo', ancho: 300 }, { titulo: 'Cantidad', ancho: 100, importe: true }, { titulo: 'Valor', ancho: 120, importe: true },
    ], [...v.filas.map((f) => [f.codigo, f.descripcion, f.cantidad, f.valor]), ['', 'Total', null, v.total], ['', 'Saldo de Mercaderías en el Mayor', null, v.mayor], ['', 'Diferencia', null, v.control]]);
  }
}
