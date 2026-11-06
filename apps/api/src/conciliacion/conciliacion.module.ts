import { Module } from '@nestjs/common';
import { ConciliacionesController } from './conciliaciones.controller';
import { ConciliacionesService } from './conciliaciones.service';
import { ReglasController } from './reglas.controller';
import { ReglasService } from './reglas.service';
import { RegistroService } from './registro.service';
import { FormatosController } from './formatos.controller';
import { FormatosService } from './formatos.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';

@Module({
  controllers: [FormatosController, ReglasController, ConciliacionesController, ImportacionesController],
  providers: [FormatosService, ReglasService, RegistroService, ConciliacionesService, ImportacionesService],
})
export class ConciliacionModule {}
