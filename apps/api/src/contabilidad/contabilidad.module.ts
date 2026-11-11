import { Module } from '@nestjs/common';
import { AsientosManualesController } from './manuales/asientos-manuales.controller';
import { AsientosManualesService } from './manuales/asientos-manuales.service';
import { ConsultasContablesController } from './consultas/consultas.controller';
import { ConsultasContablesService } from './consultas/consultas.service';
import { AjusteInflacionController } from './ajuste-inflacion/ajuste-inflacion.controller';
import { AjusteInflacionService } from './ajuste-inflacion/ajuste-inflacion.service';
import { ConfigAjusteService } from './ajuste-inflacion/config.service';
import { CierreEjercicioService } from './cierre/cierre-ejercicio.service';
import { EstadosController } from './estados/estados.controller';
import { EstadosService } from './estados/estados.service';
import { LibrosController } from './libros/libros.controller';
import { LibrosService } from './libros/libros.service';
import { PeriodosController } from './periodos/periodos.controller';
import { PeriodosService } from './periodos/periodos.service';

@Module({
  controllers: [PeriodosController, LibrosController, EstadosController, ConsultasContablesController, AsientosManualesController, AjusteInflacionController],
  providers: [PeriodosService, LibrosService, EstadosService, CierreEjercicioService, ConsultasContablesService, AsientosManualesService, ConfigAjusteService, AjusteInflacionService],
  exports: [PeriodosService, ConsultasContablesService, EstadosService],
})
export class ContabilidadModule {}
