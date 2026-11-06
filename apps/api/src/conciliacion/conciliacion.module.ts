import { Module } from '@nestjs/common';
import { FormatosController } from './formatos.controller';
import { FormatosService } from './formatos.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';

@Module({
  controllers: [FormatosController, ImportacionesController],
  providers: [FormatosService, ImportacionesService],
})
export class ConciliacionModule {}
