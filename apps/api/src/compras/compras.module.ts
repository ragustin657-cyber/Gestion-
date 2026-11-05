import { Module } from '@nestjs/common';
import { ComprobantesController } from './comprobantes/comprobantes.controller';
import { ComprobantesService } from './comprobantes/comprobantes.service';
import { OrdenesController } from './ordenes/ordenes.controller';
import { OrdenesService } from './ordenes/ordenes.service';
import { RecepcionesController } from './recepciones/recepciones.controller';
import { RecepcionesService } from './recepciones/recepciones.service';

@Module({
  controllers: [OrdenesController, RecepcionesController, ComprobantesController],
  providers: [OrdenesService, RecepcionesService, ComprobantesService],
  exports: [OrdenesService, RecepcionesService, ComprobantesService],
})
export class ComprasModule {}
