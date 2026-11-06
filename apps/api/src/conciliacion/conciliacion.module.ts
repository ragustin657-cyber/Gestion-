import { Module } from '@nestjs/common';
import { ConciliacionesController } from './conciliaciones.controller';
import { ConciliacionesService } from './conciliaciones.service';
import { FormatosController } from './formatos.controller';
import { FormatosService } from './formatos.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';

@Module({
  controllers: [FormatosController, ConciliacionesController, ImportacionesController],
  providers: [FormatosService, ConciliacionesService, ImportacionesService],
})
export class ConciliacionModule {}
