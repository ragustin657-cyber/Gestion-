import { Module } from '@nestjs/common';
import { ComprasModule } from '../compras/compras.module';
import { LibroVentasService } from './libros-iva/libro-ventas.service';
import { LibrosIvaController } from './libros-iva/libros.controller';
import { PresentacionesController } from './presentaciones/presentaciones.controller';
import { PresentacionesService } from './presentaciones/presentaciones.service';
import { ConfigImpuestosController } from './config/config-impuestos.controller';
import { ConfigImpuestosService } from './config/config-impuestos.service';

@Module({
  imports: [ComprasModule],
  controllers: [ConfigImpuestosController, LibrosIvaController, PresentacionesController],
  providers: [ConfigImpuestosService, LibroVentasService, PresentacionesService],
})
export class ImpuestosModule {}
