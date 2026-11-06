import { Module } from '@nestjs/common';
import { ConfigArcaController } from './config-arca.controller';
import { ConfigArcaService } from './config-arca.service';

@Module({ controllers: [ConfigArcaController], providers: [ConfigArcaService], exports: [ConfigArcaService] })
export class ArcaModule {}
