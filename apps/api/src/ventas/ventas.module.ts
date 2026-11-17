import { ComisionesCalculoService } from './comisiones/calculo.service';
import { ComisionesController } from './comisiones/comisiones.controller';
import { VendedoresService } from './comisiones/vendedores.service';
import { OrigenesVenta } from './comprobantes/origenes';
import { PendientesFacturarController, RemitosController } from './remitos/remitos.controller';
import { RemitosService } from './remitos/remitos.service';
import { PedidosController } from './pedidos/pedidos.controller';
import { PedidosService } from './pedidos/pedidos.service';
import { PreciosController } from './precios/precios.controller';
import { PreciosService } from './precios/precios.service';
import { Module } from '@nestjs/common';
import { ArcaModule } from '../arca/arca.module';
import { ComprobantesVentaController } from './comprobantes/comprobantes.controller';
import { ComprobantesVentaService } from './comprobantes/comprobantes.service';
import { EmisionService } from './emision/emision.service';
import { AplicacionesController } from './aplicaciones/aplicaciones.controller';
import { AplicacionesService } from './aplicaciones/aplicaciones.service';
import { RecibosController } from './recibos/recibos.controller';
import { RecibosService } from './recibos/recibos.service';
import { ConsultasVentasController } from './consultas/consultas-ventas.controller';
import { ConsultasVentasService } from './consultas/consultas-ventas.service';
import { DatosVentasController } from './consultas/datos-ventas.controller';

@Module({
  imports: [ArcaModule],
  controllers: [PreciosController, PedidosController, RemitosController, PendientesFacturarController, DatosVentasController, ConsultasVentasController, ComprobantesVentaController, AplicacionesController, RecibosController, ComisionesController],
  providers: [PreciosService, PedidosService, RemitosService, OrigenesVenta, ComprobantesVentaService, EmisionService, AplicacionesService, RecibosService, ConsultasVentasService, VendedoresService, ComisionesCalculoService],
  exports: [ComprobantesVentaService, EmisionService, AplicacionesService],
})
export class VentasModule {}
