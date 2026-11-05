import { Global, Module } from '@nestjs/common';
import { CarteraService } from './operaciones/cartera.service';
import { ConsultasTesoreriaController } from './operaciones/consultas.controller';
import { ConsultasTesoreriaService } from './operaciones/consultas.service';
import { TrasladosController } from './operaciones/traslados.controller';
import { TrasladosService } from './operaciones/traslados.service';
import { AcreditacionesService } from './operaciones/acreditaciones.service';
import { DepositosController } from './operaciones/depositos.controller';
import { DepositosService } from './operaciones/depositos.service';
import { ChequesPropiosService } from './operaciones/cheques-propios.service';
import { ChequesController } from './operaciones/cheques.controller';
import { RechazosService } from './operaciones/rechazos.service';
import { IngresosController } from './operaciones/ingresos.controller';
import { IngresosService } from './operaciones/ingresos.service';

@Global()
@Module({
  controllers: [IngresosController, ChequesController, DepositosController, TrasladosController, ConsultasTesoreriaController],
  providers: [CarteraService, IngresosService, ChequesPropiosService, RechazosService, DepositosService, AcreditacionesService, TrasladosService, ConsultasTesoreriaService],
  exports: [CarteraService, ConsultasTesoreriaService],
})
export class TesoreriaOperacionesModule {}
