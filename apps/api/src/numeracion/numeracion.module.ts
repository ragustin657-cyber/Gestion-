import { Global, Module } from '@nestjs/common';
import { NumeracionService } from './numeracion.service';

@Global()
@Module({ providers: [NumeracionService], exports: [NumeracionService] })
export class NumeracionModule {}
