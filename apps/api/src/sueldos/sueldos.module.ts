import { Module } from '@nestjs/common';
import { AsientosModule } from '../contabilidad/asientos/asientos.module';
import { ContabilizacionService } from './contabilizacion.service';
import { VacacionesController } from './vacaciones.controller';
import { VacacionesService } from './vacaciones.service';
import { EgresosController } from './egresos.controller';
import { EgresosService } from './egresos.service';
import { F931Controller } from './f931.controller';
import { F931Service } from './f931.service';
import { F572Controller } from './ganancias/f572.controller';
import { F572Service } from './ganancias/f572.service';
import { TablasGananciasController } from './ganancias/tablas.controller';
import { TablasGananciasService } from './ganancias/tablas.service';
import { LsdController } from './lsd.controller';
import { LsdService } from './lsd.service';
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
  controllers: [F572Controller, TablasGananciasController, LsdController, VacacionesController, EgresosController, F931Controller, PagosSueldosController, ContribucionesController, MaestrosSueldosController, LiquidacionesController, SalidasSueldosController],
  providers: [F572Service, TablasGananciasService, LsdService, VacacionesService, EgresosService, F931Service, PagosSueldosService, ContabilizacionService, ContribucionesService, MaestrosSueldosService, LiquidacionesService],
  exports: [TablasGananciasService, ContribucionesService, MaestrosSueldosService, LiquidacionesService],
})
export class SueldosModule {}
