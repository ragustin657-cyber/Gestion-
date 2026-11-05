import { Controller, Get, Query } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  @RequierePermiso('auditoria.ver')
  listar(@Query() q: { entidad?: string; entidadId?: string; desde?: string; hasta?: string }) {
    return this.auditoria.listar(q);
  }
}
