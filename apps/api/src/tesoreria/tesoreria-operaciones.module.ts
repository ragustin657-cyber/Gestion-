import { Global, Module } from '@nestjs/common';
import { CarteraService } from './operaciones/cartera.service';
import { ConsultasTesoreriaController } from './operaciones/consultas.controller';
import { ConsultasTesoreriaService } from './operaciones/consultas.service';
import { TrasladosController } from './operaciones/traslados.controller';
import { TrasladosService } from './operaciones/traslados.service';
import { IngresosController } from './operaciones/ingresos.controller';
import { IngresosService } from './operaciones/ingresos.service';

@Global()
@Module({
  controllers: [IngresosController, TrasladosController, ConsultasTesoreriaController],
  providers: [CarteraService, IngresosService, TrasladosService, ConsultasTesoreriaService],
  exports: [CarteraService, ConsultasTesoreriaService],
})
export class TesoreriaOperacionesModule {}
