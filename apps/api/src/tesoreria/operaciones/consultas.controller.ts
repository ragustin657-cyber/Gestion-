import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasTesoreriaService, FiltroCheques } from './consultas.service';

@Controller('tesoreria')
@RequierePermiso('tesoreria.ver')
export class ConsultasTesoreriaController {
  constructor(private readonly consultas: ConsultasTesoreriaService) {}

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
  flujo(@Query('dias') dias?: string) {
    return this.consultas.flujo(dias);
  }

  @Get('cheques/:id')
  cheque(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.cheque(id);
  }
}
