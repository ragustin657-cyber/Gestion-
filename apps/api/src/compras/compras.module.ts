import { Module } from '@nestjs/common';
import { ComprobantesController } from './comprobantes/comprobantes.controller';
import { ComprobantesService } from './comprobantes/comprobantes.service';
import { ConsultasComprasController } from './consultas/consultas.controller';
import { ConsultasComprasService } from './consultas/consultas.service';
import { OrdenesController } from './ordenes/ordenes.controller';
import { OrdenesService } from './ordenes/ordenes.service';
import { RecepcionesController } from './recepciones/recepciones.controller';
import { RecepcionesService } from './recepciones/recepciones.service';

@Module({
  controllers: [OrdenesController, RecepcionesController, ComprobantesController, ConsultasComprasController],
  providers: [OrdenesService, RecepcionesService, ComprobantesService, ConsultasComprasService],
  exports: [OrdenesService, RecepcionesService, ComprobantesService],
})
export class ComprasModule {}
