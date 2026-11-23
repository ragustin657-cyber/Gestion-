import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { esUuid } from '../../comun/esquemas';
import { ObligacionFceService } from './obligacion.service';

@Controller('ventas/fce')
export class FceVentasController {
  constructor(private readonly obligacion: ObligacionFceService) {}

  /** ¿Corresponde factura de crédito MiPyME? (E50) */
  @Get('obligacion')
  @RequierePermiso('venta.emitir')
  consultar(@Query() q: { terceroId?: string; fecha?: string; total?: string }) {
    if (!q.terceroId || !esUuid(q.terceroId)) throw new BadRequestException('Indique el cliente');
    if (!q.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha)) throw new BadRequestException('Fecha inválida');
    if (q.total !== undefined && q.total !== '' && Number.isNaN(Number(q.total))) throw new BadRequestException('Total inválido');
    return this.obligacion.consultar(q.terceroId, q.fecha, q.total);
  }
}
