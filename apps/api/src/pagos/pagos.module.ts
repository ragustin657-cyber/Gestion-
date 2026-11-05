import { Global, Module } from '@nestjs/common';
import { ConfigPagosController } from './config/config-pagos.controller';
import { ConfigPagosService } from './config/config-pagos.service';
import { PadronController } from './padron/padron.controller';
import { PadronService } from './padron/padron.service';
import { RetencionesService } from './retenciones/retenciones.service';

@Global()
@Module({
  controllers: [ConfigPagosController, PadronController],
  providers: [ConfigPagosService, PadronService, RetencionesService],
  exports: [ConfigPagosService, PadronService, RetencionesService],
})
export class PagosModule {}
