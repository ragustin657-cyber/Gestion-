import { Module } from '@nestjs/common';
import { ContribucionesController } from './contribuciones.controller';
import { ContribucionesService } from './contribuciones.service';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { MaestrosSueldosController } from './maestros.controller';
import { MaestrosSueldosService } from './maestros.service';
import { SalidasSueldosController } from './salidas.controller';

@Module({
  controllers: [ContribucionesController, MaestrosSueldosController, LiquidacionesController, SalidasSueldosController],
  providers: [ContribucionesService, MaestrosSueldosService, LiquidacionesService],
  exports: [ContribucionesService, MaestrosSueldosService, LiquidacionesService],
})
export class SueldosModule {}
