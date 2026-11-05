import { Global, Module } from '@nestjs/common';
import { ConfigPagosController } from './config/config-pagos.controller';
import { ConfigPagosService } from './config/config-pagos.service';
import { PadronController } from './padron/padron.controller';
import { PadronService } from './padron/padron.service';
import { RetencionesService } from './retenciones/retenciones.service';
import { OrdenesPagoController } from './ordenes/ordenes-pago.controller';
import { OrdenesPagoService } from './ordenes/ordenes-pago.service';
import { PagoService } from './ordenes/pago.service';

@Global()
@Module({
  controllers: [ConfigPagosController, PadronController, OrdenesPagoController],
  providers: [ConfigPagosService, PadronService, RetencionesService, OrdenesPagoService, PagoService],
  exports: [ConfigPagosService, PadronService, RetencionesService, OrdenesPagoService],
})
export class PagosModule {}
