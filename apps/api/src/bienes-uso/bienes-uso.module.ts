import { Global, Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AmortizacionController } from './amortizacion.controller';
import { AmortizacionService } from './amortizacion.service';
import { BajasService } from './bajas.service';
import { BienesController } from './bienes.controller';
import { PlanillaController } from './planilla.controller';
import { PlanillaImpositivaController } from './planilla-impositiva.controller';
import { PlanillaImpositivaService } from './planilla-impositiva.service';
import { PlanillaService } from './planilla.service';
import { BienesService } from './bienes.service';
import { RubrosController } from './rubros.controller';
import { RubrosService } from './rubros.service';

@Global()
@Module({
  imports: [ContabilidadModule],
  controllers: [RubrosController, AmortizacionController, PlanillaController, PlanillaImpositivaController, BienesController],
  providers: [RubrosService, BienesService, AmortizacionService, BajasService, PlanillaService, PlanillaImpositivaService],
  exports: [RubrosService, BienesService, AmortizacionService, BajasService, PlanillaImpositivaService],
})
export class BienesUsoModule {}
