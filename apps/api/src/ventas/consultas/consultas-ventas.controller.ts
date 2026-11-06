import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasVentasService, FiltroVentas } from './consultas-ventas.service';

@Controller('ventas')
@RequierePermiso('venta.ver')
export class ConsultasVentasController {
  constructor(private readonly consultas: ConsultasVentasService) {}

  @Get('comprobantes')
  comprobantes(@Query() f: FiltroVentas) {
    return this.consultas.comprobantes(f);
  }

  @Get('comprobantes/:id')
  comprobante(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.comprobante(id);
  }

  @Get('recibos')
  recibos(@Query() f: FiltroVentas) {
    return this.consultas.recibos(f);
  }

  @Get('clientes/:id/cuenta-corriente')
  cuentaCorriente(@Param('id', ParseUUIDPipe) id: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.consultas.cuentaCorriente(id, desde, hasta);
  }

  @Get('saldos')
  saldos(@Query('fecha') fecha?: string) {
    return this.consultas.saldosClientes(fecha);
  }
}
