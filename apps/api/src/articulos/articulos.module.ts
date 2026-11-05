import { Module } from '@nestjs/common';
import { ArticulosController } from './articulos.controller';
import { ArticulosService } from './articulos.service';

@Module({ controllers: [ArticulosController], providers: [ArticulosService] })
export class ArticulosModule {}
