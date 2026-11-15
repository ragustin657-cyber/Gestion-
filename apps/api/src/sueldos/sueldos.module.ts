import { Module } from '@nestjs/common';
import { MaestrosSueldosController } from './maestros.controller';
import { MaestrosSueldosService } from './maestros.service';

@Module({
  controllers: [MaestrosSueldosController],
  providers: [MaestrosSueldosService],
  exports: [MaestrosSueldosService],
})
export class SueldosModule {}
