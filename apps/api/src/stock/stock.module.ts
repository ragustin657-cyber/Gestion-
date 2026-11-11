import { Global, Module } from '@nestjs/common';
import { ConfigStockService } from './config-stock.service';
import { StockController } from './stock.controller';

@Global()
@Module({ controllers: [StockController], providers: [ConfigStockService], exports: [ConfigStockService] })
export class StockModule {}
