import { Global, Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { BienesController } from './bienes.controller';
import { BienesService } from './bienes.service';
import { RubrosController } from './rubros.controller';
import { RubrosService } from './rubros.service';

@Global()
@Module({
  imports: [ContabilidadModule],
  controllers: [RubrosController, BienesController],
  providers: [RubrosService, BienesService],
  exports: [RubrosService, BienesService],
})
export class BienesUsoModule {}
