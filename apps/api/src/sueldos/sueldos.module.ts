import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { MaestrosSueldosController } from './maestros.controller';
import { MaestrosSueldosService } from './maestros.service';
import { SalidasSueldosController } from './salidas.controller';

@Module({
  controllers: [MaestrosSueldosController, LiquidacionesController, SalidasSueldosController],
  providers: [MaestrosSueldosService, LiquidacionesService],
  exports: [MaestrosSueldosService, LiquidacionesService],
})
export class SueldosModule {}
