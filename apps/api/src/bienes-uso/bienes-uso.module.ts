import { Global, Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { RubrosController } from './rubros.controller';
import { RubrosService } from './rubros.service';

@Global()
@Module({
  imports: [ContabilidadModule],
  controllers: [RubrosController],
  providers: [RubrosService],
  exports: [RubrosService],
})
export class BienesUsoModule {}
