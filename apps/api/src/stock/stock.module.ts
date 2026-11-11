import { Global, Module } from '@nestjs/common';
import { ConfigStockService } from './config-stock.service';
import { StockController } from './stock.controller';
import { DocumentosStockController } from './documentos/documentos.controller';
import { DocumentosStockService } from './documentos/documentos.service';
import { MotorStock } from './motor';

@Global()
@Module({
  controllers: [StockController, DocumentosStockController],
  providers: [ConfigStockService, MotorStock, DocumentosStockService],
  exports: [ConfigStockService, MotorStock, DocumentosStockService],
})
export class StockModule {}
