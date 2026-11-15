import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { MaestrosSueldosController } from './maestros.controller';
import { MaestrosSueldosService } from './maestros.service';

@Module({
  controllers: [MaestrosSueldosController, LiquidacionesController],
  providers: [MaestrosSueldosService, LiquidacionesService],
  exports: [MaestrosSueldosService, LiquidacionesService],
})
export class SueldosModule {}
