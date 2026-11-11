import { Module } from '@nestjs/common';
import { IndicesInflacionController } from './indices-inflacion.controller';
import { IndicesInflacionService } from './indices-inflacion.service';

@Module({ controllers: [IndicesInflacionController], providers: [IndicesInflacionService] })
export class IndicesInflacionModule {}
