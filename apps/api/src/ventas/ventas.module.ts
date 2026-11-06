import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';
import { EmisionService } from './emision/emision.service';
import { AplicacionesController } from './aplicaciones/aplicaciones.controller';
import { AplicacionesService } from './aplicaciones/aplicaciones.service';

@Module({
  imports: [ArcaModule],
  controllers: [ComprobantesVentaController, AplicacionesController],
  providers: [ComprobantesVentaService, EmisionService, AplicacionesService],
  exports: [ComprobantesVentaService, EmisionService, AplicacionesService],
})
export class VentasModule {}
