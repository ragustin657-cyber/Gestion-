import { Module } from '@nestjs/common';
import { AsientosManualesController } from './manuales/asientos-manuales.controller';
import { AsientosManualesService } from './manuales/asientos-manuales.service';
import { ConsultasContablesController } from './consultas/consultas.controller';
import { ConsultasContablesService } from './consultas/consultas.service';
import { PeriodosController } from './periodos/periodos.controller';
import { PeriodosService } from './periodos/periodos.service';

@Module({
  controllers: [PeriodosController, ConsultasContablesController, AsientosManualesController],
  providers: [PeriodosService, ConsultasContablesService, AsientosManualesService],
  exports: [PeriodosService, ConsultasContablesService],
})
export class ContabilidadModule {}
