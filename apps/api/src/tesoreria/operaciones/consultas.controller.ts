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

  @Get('cheques/:id')
  cheque(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.cheque(id);
  }
}
