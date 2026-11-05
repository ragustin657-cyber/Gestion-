import { Global, Module } from '@nestjs/common';
import { ConfigPagosController } from './config/config-pagos.controller';
import { ConfigPagosService } from './config/config-pagos.service';
import { PadronController } from './padron/padron.controller';
import { PadronService } from './padron/padron.service';

@Global()
@Module({
  controllers: [ConfigPagosController, PadronController],
  providers: [ConfigPagosService, PadronService],
  exports: [ConfigPagosService, PadronService],
})
export class PagosModule {}
