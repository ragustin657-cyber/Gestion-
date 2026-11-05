import { Global, Module } from '@nestjs/common';
import { AsientosService } from './asientos.service';

@Global()
@Module({ providers: [AsientosService], exports: [AsientosService] })
export class AsientosModule {}
