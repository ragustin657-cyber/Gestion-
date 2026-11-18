import { Module } from '@nestjs/common';
import { ConfigCorreoService } from './config-correo.service';
import { CorreoController } from './correo.controller';
import { TransporteCorreo, TransporteMemoria, TransporteSmtp } from './transporte';

@Module({
  controllers: [CorreoController],
  providers: [ConfigCorreoService, { provide: TransporteCorreo, useClass: process.env.TRANSPORTE_CORREO === 'prueba' ? TransporteMemoria : TransporteSmtp }],
  exports: [ConfigCorreoService, TransporteCorreo],
})
export class CorreoModule {}
