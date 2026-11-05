import { Module } from '@nestjs/common';
import { OrdenesController } from './ordenes/ordenes.controller';
import { OrdenesService } from './ordenes/ordenes.service';
import { RecepcionesController } from './recepciones/recepciones.controller';
import { RecepcionesService } from './recepciones/recepciones.service';

@Module({
  controllers: [OrdenesController, RecepcionesController],
  providers: [OrdenesService, RecepcionesService],
  exports: [OrdenesService, RecepcionesService],
})
export class ComprasModule {}
