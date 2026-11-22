import { BienesPersonalesController } from './bienes-personales/bienes-personales.controller';
import { BienesPersonalesService } from './bienes-personales/bienes-personales.service';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { DjGananciasController } from './dj-ganancias/dj-ganancias.controller';
import { DjGananciasService } from './dj-ganancias/dj-ganancias.service';
import { AjusteImpositivoController } from './ajuste-inflacion/ajuste-impositivo.controller';
import { AjusteImpositivoService } from './ajuste-inflacion/ajuste-impositivo.service';
import { Module } from '@nestjs/common';
import { ComprasModule } from '../compras/compras.module';
import { LibroVentasService } from './libros-iva/libro-ventas.service';
import { LibrosIvaController } from './libros-iva/libros.controller';
import { PresentacionesController } from './presentaciones/presentaciones.controller';
import { ControlArcaController } from './control-arca/control-arca.controller';
import { ControlArcaService } from './control-arca/control-arca.service';
import { PresentacionesService } from './presentaciones/presentaciones.service';
import { ConfigImpuestosController } from './config/config-impuestos.controller';
import { ConfigImpuestosService } from './config/config-impuestos.service';
import { PosicionIvaController } from './posicion-iva/posicion-iva.controller';
import { PosicionIvaService } from './posicion-iva/posicion-iva.service';
import { PosicionIibbController } from './posicion-iibb/posicion-iibb.controller';
import { PosicionIibbService } from './posicion-iibb/posicion-iibb.service';

@Module({
  imports: [ComprasModule, ContabilidadModule],
  controllers: [BienesPersonalesController, DjGananciasController, AjusteImpositivoController, ConfigImpuestosController, LibrosIvaController, PresentacionesController, ControlArcaController, PosicionIvaController, PosicionIibbController],
  providers: [BienesPersonalesService, DjGananciasService, AjusteImpositivoService, ConfigImpuestosService, LibroVentasService, PresentacionesService, ControlArcaService, PosicionIvaService, PosicionIibbService],
})
export class ImpuestosModule {}
