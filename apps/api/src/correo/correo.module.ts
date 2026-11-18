import { Module } from '@nestjs/common';
import { ConfigCorreoService } from './config-correo.service';
import { CorreoController } from './correo.controller';
import { crearTransporte, TransporteCorreo } from './transporte';

@Module({
  controllers: [CorreoController],
  providers: [ConfigCorreoService, { provide: TransporteCorreo, useFactory: crearTransporte }],
  exports: [ConfigCorreoService, TransporteCorreo],
})
export class CorreoModule {}
