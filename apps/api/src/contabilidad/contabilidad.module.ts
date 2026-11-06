import { Module } from '@nestjs/common';
import { AsientosManualesController } from './manuales/asientos-manuales.controller';
import { AsientosManualesService } from './manuales/asientos-manuales.service';
import { ConsultasContablesController } from './consultas/consultas.controller';
import { ConsultasContablesService } from './consultas/consultas.service';
import { CierreEjercicioService } from './cierre/cierre-ejercicio.service';
import { EstadosController } from './estados/estados.controller';
import { EstadosService } from './estados/estados.service';
import { PeriodosController } from './periodos/periodos.controller';
import { PeriodosService } from './periodos/periodos.service';

@Module({
  controllers: [PeriodosController, EstadosController, ConsultasContablesController, AsientosManualesController],
  providers: [PeriodosService, EstadosService, CierreEjercicioService, ConsultasContablesService, AsientosManualesService],
  exports: [PeriodosService, ConsultasContablesService, EstadosService],
})
export class ContabilidadModule {}
