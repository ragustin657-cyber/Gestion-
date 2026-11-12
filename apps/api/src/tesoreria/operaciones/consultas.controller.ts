import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Columna, tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { FlujoService, ParamsFlujo } from '../../finanzas/flujo.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasTesoreriaService, FiltroCheques } from './consultas.service';

@Controller('tesoreria')
@RequierePermiso('tesoreria.ver')
export class ConsultasTesoreriaController {
  constructor(private readonly consultas: ConsultasTesoreriaService, private readonly flujos: FlujoService) {}

  @Get('cheques')
  cheques(@Query() q: FiltroCheques) {
    return this.consultas.cheques(q);
  }

  @Get('saldos')
  saldos(@Query('fecha') fecha?: string) {
    return this.consultas.saldos(fecha);
  }

  @Get('movimientos')
  movimientos(@Query() q: { cuentaBancariaId?: string; cajaId?: string; desde?: string; hasta?: string }) {
    return this.consultas.movimientos(q);
  }

  @Get('flujo')
  async flujo(@Query() q: ParamsFlujo & { formato?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.flujos.flujo(q);
    if (!q.formato) return r;
    const imp = (titulo: string): Columna => ({ titulo, ancho: 70, importe: true });
    const columnas: Columna[] = [{ titulo: 'Período', ancho: 90 }, imp('Cheques'), imp('Transferencias'), imp('Cobranzas'), imp('Vencido a cobrar'), imp('Cheques propios'), imp('OP'), imp('Proveedores'), imp('Vencido a pagar'), imp('Saldo')];
    const filas = [['Saldo inicial', null, null, null, null, null, null, null, null, r.saldoInicial], ...r.filas.map((f) => [f.etiqueta, f.ingresos.cheques, f.ingresos.transferencias, f.ingresos.cobranzas, f.ingresos.vencidoACobrar, f.egresos.chequesPropios, f.egresos.ordenesPago, f.egresos.proveedores, f.egresos.vencidoAPagar, f.saldo])];
    const titulo = 'Flujo de fondos proyectado';
    const subtitulo = `Del ${r.desde.split('-').reverse().join('/')} al ${r.hasta.split('-').reverse().join('/')}${r.incluirVencidos ? '' : ' · sin vencidos'}`;
    if (q.formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="flujo-${r.desde}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, subtitulo, columnas, filas));
    }
    if (q.formato === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="flujo-${r.desde}.pdf"` });
      return new StreamableFile(await tablaPdf(await this.flujos.razonSocial(), titulo, subtitulo, columnas, filas));
    }
    throw new BadRequestException('Formato inválido: use xlsx o pdf');
  }

  @Get('flujo/detalle')
  detalleFlujo(@Query() q: { desde?: string; hasta?: string; incluirVencidos?: string }) {
    return this.flujos.detalle(q);
  }

  @Get('cheques/:id')
  cheque(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.cheque(id);
  }
}
