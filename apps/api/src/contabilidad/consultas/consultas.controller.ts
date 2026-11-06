import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { fechaAR } from '../../compras/comun';
import { ConsultasContablesService } from './consultas.service';
import { Columna, Fila, tablaPdf, tablaXlsx } from './exportar';

type Q = Record<string, string | undefined>;
const f = (d: Date | string) => fechaAR(new Date(d));

@Controller('contabilidad')
@RequierePermiso('plancuentas.ver')
export class ConsultasContablesController {
  constructor(private readonly consultas: ConsultasContablesService) {}

  /** Devuelve los datos o el archivo pedido en `formato`. */
  private async salida<T>(formato: string | undefined, res: Response, nombre: string, datos: T, tabla: () => { titulo: string; subtitulo: string; columnas: Columna[]; filas: Fila[] }) {
    if (!formato) return datos;
    if (!['xlsx', 'pdf'].includes(formato)) throw new BadRequestException('Formato inválido: use xlsx o pdf');
    const t = tabla();
    const e = await this.consultas.empresa();
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.${formato}"`);
    return new StreamableFile(formato === 'pdf' ? await tablaPdf(e.razonSocial, t.titulo, t.subtitulo, t.columnas, t.filas) : await tablaXlsx(t.titulo, t.subtitulo, t.columnas, t.filas));
  }

  @Get('diario')
  async diario(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const d = await this.consultas.diario(q, !!q.formato);
    return this.salida(q.formato, res, 'libro-diario', d, () => ({
      titulo: 'Libro Diario', subtitulo: `${q.desde ? f(q.desde) : ''} al ${q.hasta ? f(q.hasta) : ''}`,
      columnas: [{ titulo: 'Asiento', ancho: 50 }, { titulo: 'Fecha', ancho: 60 }, { titulo: 'Cuenta', ancho: 300 }, { titulo: 'Detalle', ancho: 200 }, { titulo: 'Debe', ancho: 85, importe: true }, { titulo: 'Haber', ancho: 85, importe: true }],
      filas: [
        ...d.items.flatMap((a) => [
          [a.numeroDefinitivo ?? `(${a.numero})`, f(a.fecha), a.descripcion, '', null, null] as Fila,
          ...a.renglones.map((r) => ['', '', `${r.cuenta.codigo} ${r.cuenta.nombre}`, r.detalle ?? '', r.debe === '0' ? null : r.debe, r.haber === '0' ? null : r.haber] as Fila),
        ]),
        ['', '', 'Totales', '', d.totales.debe, d.totales.haber],
      ],
    }));
  }

  @Get('asientos/:id')
  asiento(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.asiento(id);
  }

  @Get('mayor')
  async mayor(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const m = await this.consultas.mayor(q);
    return this.salida(q.formato, res, `mayor-${m.cuenta.codigo}`, m, () => ({
      titulo: `Mayor ${m.cuenta.codigo} ${m.cuenta.nombre}`, subtitulo: `${q.desde ? f(q.desde) : ''} al ${q.hasta ? f(q.hasta) : ''}`,
      columnas: [{ titulo: 'Fecha', ancho: 60 }, { titulo: 'Asiento', ancho: 50 }, { titulo: 'Descripción', ancho: 410 }, { titulo: 'Debe', ancho: 85, importe: true }, { titulo: 'Haber', ancho: 85, importe: true }, { titulo: 'Saldo', ancho: 90, importe: true }],
      filas: [
        ['', '', 'Saldo inicial', null, null, m.saldoInicial],
        ...m.movimientos.map((x) => [f(x.fecha), x.numero, x.descripcion, x.debe, x.haber, x.saldo] as Fila),
        ['', '', 'Saldo final', null, null, m.saldoFinal],
      ],
    }));
  }

  @Get('sumas-saldos')
  async sumasSaldos(@Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const s = await this.consultas.sumasSaldos(q);
    return this.salida(q.formato, res, 'sumas-y-saldos', s, () => ({
      titulo: 'Balance de sumas y saldos', subtitulo: `Ejercicio ${s.ejercicio.numero} · ${f(s.desde)} al ${f(s.hasta)}`,
      columnas: [{ titulo: 'Cuenta', ancho: 382 }, { titulo: 'Debe', ancho: 100, importe: true }, { titulo: 'Haber', ancho: 100, importe: true }, { titulo: 'Saldo deudor', ancho: 100, importe: true }, { titulo: 'Saldo acreedor', ancho: 100, importe: true }],
      filas: [
        ...s.filas.map((x) => [`${'  '.repeat(x.nivel - 1)}${x.codigo} ${x.nombre}`, x.debe, x.haber, x.saldoDeudor, x.saldoAcreedor] as Fila),
        ['Totales', s.totales.debe, s.totales.haber, s.totales.saldoDeudor, s.totales.saldoAcreedor],
      ],
    }));
  }
}
