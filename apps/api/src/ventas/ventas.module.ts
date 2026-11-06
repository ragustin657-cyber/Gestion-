import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';

@Module({
  imports: [ArcaModule],
  controllers: [ComprobantesVentaController],
  providers: [ComprobantesVentaService],
})
export class VentasModule {}
