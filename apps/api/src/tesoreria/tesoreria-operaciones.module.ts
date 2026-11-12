import { FlujoService } from '../finanzas/flujo.service';
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
import { BancosCajasController } from './operaciones/bancos-cajas.controller';
import { BancosService } from './operaciones/bancos.service';
import { CajasService } from './operaciones/cajas.service';
import { ChequesController } from './operaciones/cheques.controller';
import { RechazosService } from './operaciones/rechazos.service';
import { IngresosController } from './operaciones/ingresos.controller';
import { IngresosService } from './operaciones/ingresos.service';

@Global()
@Module({
  controllers: [IngresosController, BancosCajasController, ChequesController, DepositosController, TrasladosController, ConsultasTesoreriaController],
  providers: [CarteraService, IngresosService, BancosService, CajasService, ChequesPropiosService, RechazosService, DepositosService, AcreditacionesService, TrasladosService, ConsultasTesoreriaService, FlujoService],
  exports: [CarteraService, ConsultasTesoreriaService, BancosService, IngresosService],
})
export class TesoreriaOperacionesModule {}
