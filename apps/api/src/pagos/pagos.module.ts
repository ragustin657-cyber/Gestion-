import { Global, Module } from '@nestjs/common';
import { ConfigPagosController } from './config/config-pagos.controller';
import { ConfigPagosService } from './config/config-pagos.service';

@Global()
@Module({ controllers: [ConfigPagosController], providers: [ConfigPagosService], exports: [ConfigPagosService] })
export class PagosModule {}
