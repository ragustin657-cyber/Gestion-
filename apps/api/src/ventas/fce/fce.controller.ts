import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { esUuid } from '../../comun/esquemas';
import { ObligacionFceService } from './obligacion.service';
import { FceRegistroService } from './registro.service';

const ESTADOS = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'ACEPTADA_TACITA'];

@Controller('ventas/fce')
export class FceVentasController {
  constructor(private readonly obligacion: ObligacionFceService, private readonly registro: FceRegistroService) {}

  /** FCE emitidas con su estado en el registro de ARCA (E50 §5). */
  @Get()
  @RequierePermiso('venta.ver')
  listar(@Query('estado') estado?: string) {
    if (estado && !ESTADOS.includes(estado)) throw new BadRequestException('Estado inválido');
    return this.registro.listar('EMISOR', estado || undefined);
  }

  @Post('actualizar')
  @RequierePermiso('venta.ver')
  actualizar() {
    return this.registro.actualizar('EMISOR');
  }

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
