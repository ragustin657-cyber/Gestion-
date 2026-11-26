import { TransportistasController, TransportistasService } from './transportistas';
import { Module } from '@nestjs/common';
import { TercerosController } from './terceros.controller';
import { TercerosService } from './terceros.service';

@Module({ controllers: [TercerosController, TransportistasController], providers: [TercerosService, TransportistasService], exports: [TercerosService] })
export class TercerosModule {}
