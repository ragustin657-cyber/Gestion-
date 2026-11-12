import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { InformesController } from './informes.controller';
import { InformesService } from './informes.service';

@Module({ imports: [ContabilidadModule], controllers: [InformesController], providers: [InformesService] })
export class InformesModule {}
