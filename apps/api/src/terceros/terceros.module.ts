import { Module } from '@nestjs/common';
import { TercerosController } from './terceros.controller';
import { TercerosService } from './terceros.service';

@Module({ controllers: [TercerosController], providers: [TercerosService], exports: [TercerosService] })
export class TercerosModule {}
