import { Module } from '@nestjs/common';
import { ConfigImpuestosController } from './config/config-impuestos.controller';
import { ConfigImpuestosService } from './config/config-impuestos.service';

@Module({
  controllers: [ConfigImpuestosController],
  providers: [ConfigImpuestosService],
})
export class ImpuestosModule {}
