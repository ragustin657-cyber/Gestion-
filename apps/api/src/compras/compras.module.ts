import { Module } from '@nestjs/common';
import { OrdenesController } from './ordenes/ordenes.controller';
import { OrdenesService } from './ordenes/ordenes.service';

@Module({ controllers: [OrdenesController], providers: [OrdenesService], exports: [OrdenesService] })
export class ComprasModule {}
