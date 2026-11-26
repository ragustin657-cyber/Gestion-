import { Module } from '@nestjs/common';
import { ArticulosController } from './articulos.controller';
import { ArticulosService } from './articulos.service';
import { RubrosArticulosController } from './rubros.controller';
import { RubrosArticulosService } from './rubros.service';

@Module({ controllers: [ArticulosController, RubrosArticulosController], providers: [ArticulosService, RubrosArticulosService] })
export class ArticulosModule {}
