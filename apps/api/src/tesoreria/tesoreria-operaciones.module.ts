import { Global, Module } from '@nestjs/common';
import { CarteraService } from './operaciones/cartera.service';
import { IngresosController } from './operaciones/ingresos.controller';
import { IngresosService } from './operaciones/ingresos.service';

@Global()
@Module({
  controllers: [IngresosController],
  providers: [CarteraService, IngresosService],
  exports: [CarteraService],
})
export class TesoreriaOperacionesModule {}
