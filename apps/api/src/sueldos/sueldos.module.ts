import { Module } from '@nestjs/common';
import { AsientosModule } from '../contabilidad/asientos/asientos.module';
import { ContabilizacionService } from './contabilizacion.service';
import { PagosSueldosController } from './pagos.controller';
import { PagosSueldosService } from './pagos.service';
import { ContribucionesController } from './contribuciones.controller';
import { ContribucionesService } from './contribuciones.service';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { MaestrosSueldosController } from './maestros.controller';
import { MaestrosSueldosService } from './maestros.service';
import { SalidasSueldosController } from './salidas.controller';

@Module({
  imports: [AsientosModule],
  controllers: [PagosSueldosController, ContribucionesController, MaestrosSueldosController, LiquidacionesController, SalidasSueldosController],
  providers: [PagosSueldosService, ContabilizacionService, ContribucionesService, MaestrosSueldosService, LiquidacionesService],
  exports: [ContribucionesService, MaestrosSueldosService, LiquidacionesService],
})
export class SueldosModule {}
