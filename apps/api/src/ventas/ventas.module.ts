import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';
import { EmisionService } from './emision/emision.service';
import { AplicacionesController } from './aplicaciones/aplicaciones.controller';
import { AplicacionesService } from './aplicaciones/aplicaciones.service';
import { RecibosController } from './recibos/recibos.controller';
import { RecibosService } from './recibos/recibos.service';

@Module({
  imports: [ArcaModule],
  controllers: [ComprobantesVentaController, AplicacionesController, RecibosController],
  providers: [ComprobantesVentaService, EmisionService, AplicacionesService, RecibosService],
  exports: [ComprobantesVentaService, EmisionService, AplicacionesService],
})
export class VentasModule {}
