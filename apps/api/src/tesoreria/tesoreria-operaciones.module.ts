import { Global, Module } from '@nestjs/common';
import { CarteraService } from './operaciones/cartera.service';
import { ConsultasTesoreriaController } from './operaciones/consultas.controller';
import { ConsultasTesoreriaService } from './operaciones/consultas.service';
import { IngresosController } from './operaciones/ingresos.controller';
import { IngresosService } from './operaciones/ingresos.service';

@Global()
@Module({
  controllers: [IngresosController, ConsultasTesoreriaController],
  providers: [CarteraService, IngresosService, ConsultasTesoreriaService],
  exports: [CarteraService, ConsultasTesoreriaService],
})
export class TesoreriaOperacionesModule {}
