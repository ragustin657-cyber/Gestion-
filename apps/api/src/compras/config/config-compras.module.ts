import { Global, Module } from '@nestjs/common';
import { ConfigComprasController } from './config-compras.controller';
import { ConfigComprasService } from './config-compras.service';

@Global()
@Module({ controllers: [ConfigComprasController], providers: [ConfigComprasService], exports: [ConfigComprasService] })
export class ConfigComprasModule {}
