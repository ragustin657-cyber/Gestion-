import { Module } from '@nestjs/common';
import { PeriodosController } from './periodos/periodos.controller';
import { PeriodosService } from './periodos/periodos.service';

@Module({
  controllers: [PeriodosController],
  providers: [PeriodosService],
  exports: [PeriodosService],
})
export class ContabilidadModule {}
