import { PreciosController } from './precios/precios.controller';
import { PreciosService } from './precios/precios.service';
import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';
import { EmisionService } from './emision/emision.service';
import { AplicacionesController } from './aplicaciones/aplicaciones.controller';
import { AplicacionesService } from './aplicaciones/aplicaciones.service';
import { RecibosController } from './recibos/recibos.controller';
import { RecibosService } from './recibos/recibos.service';
import { ConsultasVentasController } from './consultas/consultas-ventas.controller';
import { ConsultasVentasService } from './consultas/consultas-ventas.service';
import { DatosVentasController } from './consultas/datos-ventas.controller';

@Module({
  imports: [ArcaModule],
  controllers: [PreciosController, DatosVentasController, ConsultasVentasController, ComprobantesVentaController, AplicacionesController, RecibosController],
  providers: [PreciosService, ComprobantesVentaService, EmisionService, AplicacionesService, RecibosService, ConsultasVentasService],
  exports: [ComprobantesVentaService, EmisionService, AplicacionesService],
})
export class VentasModule {}
