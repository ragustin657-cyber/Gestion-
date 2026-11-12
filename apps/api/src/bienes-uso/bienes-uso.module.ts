import { Global, Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AmortizacionController } from './amortizacion.controller';
import { AmortizacionService } from './amortizacion.service';
import { BajasService } from './bajas.service';
import { BienesController } from './bienes.controller';
import { PlanillaController } from './planilla.controller';
import { PlanillaService } from './planilla.service';
import { BienesService } from './bienes.service';
import { RubrosController } from './rubros.controller';
import { RubrosService } from './rubros.service';

@Global()
@Module({
  imports: [ContabilidadModule],
  controllers: [RubrosController, AmortizacionController, PlanillaController, BienesController],
  providers: [RubrosService, BienesService, AmortizacionService, BajasService, PlanillaService],
  exports: [RubrosService, BienesService, AmortizacionService, BajasService],
})
export class BienesUsoModule {}
