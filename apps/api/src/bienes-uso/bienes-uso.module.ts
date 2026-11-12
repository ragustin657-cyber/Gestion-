import { Global, Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { AmortizacionController } from './amortizacion.controller';
import { AmortizacionService } from './amortizacion.service';
import { BajasService } from './bajas.service';
import { BienesController } from './bienes.controller';
import { BienesService } from './bienes.service';
import { RubrosController } from './rubros.controller';
import { RubrosService } from './rubros.service';

@Global()
@Module({
  imports: [ContabilidadModule],
  controllers: [RubrosController, AmortizacionController, BienesController],
  providers: [RubrosService, BienesService, AmortizacionService, BajasService],
  exports: [RubrosService, BienesService, AmortizacionService, BajasService],
})
export class BienesUsoModule {}
