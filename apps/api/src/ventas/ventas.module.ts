import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';
import { EmisionService } from './emision/emision.service';

@Module({
  imports: [ArcaModule],
  controllers: [ComprobantesVentaController],
  providers: [ComprobantesVentaService, EmisionService],
  exports: [ComprobantesVentaService, EmisionService],
})
export class VentasModule {}
