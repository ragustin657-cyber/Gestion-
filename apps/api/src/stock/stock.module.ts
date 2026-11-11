import { Global, Module } from '@nestjs/common';
import { ConfigStockService } from './config-stock.service';
import { StockController } from './stock.controller';
import { DocumentosStockController } from './documentos/documentos.controller';
import { DocumentosStockService } from './documentos/documentos.service';
import { MotorStock } from './motor';
import { ComprasStock } from './compras-stock';

@Global()
@Module({
  controllers: [StockController, DocumentosStockController],
  providers: [ConfigStockService, MotorStock, DocumentosStockService, ComprasStock],
  exports: [ConfigStockService, MotorStock, DocumentosStockService, ComprasStock],
})
export class StockModule {}
