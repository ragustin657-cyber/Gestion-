import { Module } from '@nestjs/common';
import { AsientosManualesController } from './manuales/asientos-manuales.controller';
import { AsientosManualesService } from './manuales/asientos-manuales.service';
import { PeriodosController } from './periodos/periodos.controller';
import { PeriodosService } from './periodos/periodos.service';

@Module({
  controllers: [PeriodosController, AsientosManualesController],
  providers: [PeriodosService, AsientosManualesService],
  exports: [PeriodosService],
})
export class ContabilidadModule {}
