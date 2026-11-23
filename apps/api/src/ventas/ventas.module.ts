import { FceRegistroService } from './fce/registro.service';
import { FceVentasController } from './fce/fce.controller';
import { ObligacionFceService } from './fce/obligacion.service';
import { MailCobranzasService } from './cobranzas/mail.service';
import { CorreoModule } from '../correo/correo.module';
import { LiquidacionesInteresesService } from './intereses/liquidaciones.service';
import { InteresesCalculoService } from './intereses/calculo.service';
import { InteresesController } from './intereses/intereses.controller';
import { ConfigInteresesService } from './intereses/config.service';
import { AgendaCobranzasService } from './cobranzas/agenda.service';
import { CobranzasController } from './cobranzas/cobranzas.controller';
import { GestionesService } from './cobranzas/gestiones.service';
import { LiquidacionesComisionesService } from './comisiones/liquidaciones.service';
import { ComisionesCalculoService } from './comisiones/calculo.service';
import { ComisionesController } from './comisiones/comisiones.controller';
import { VendedoresService } from './comisiones/vendedores.service';
import { OrigenesVenta } from './comprobantes/origenes';
import { PercepcionesVentaService } from './percepciones/percepciones.service';
import { PendientesFacturarController, RemitosController } from './remitos/remitos.controller';
import { RemitosService } from './remitos/remitos.service';
import { PedidosController } from './pedidos/pedidos.controller';
import { PedidosService } from './pedidos/pedidos.service';
import { PreciosController } from './precios/precios.controller';
import { PreciosService } from './precios/precios.service';
import { Module } from '@nestjs/common';
import { SueldosModule } from '../sueldos/sueldos.module';
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
  imports: [ArcaModule, SueldosModule, CorreoModule],
  controllers: [PreciosController, PedidosController, RemitosController, PendientesFacturarController, DatosVentasController, ConsultasVentasController, ComprobantesVentaController, AplicacionesController, RecibosController, ComisionesController, CobranzasController, InteresesController, FceVentasController],
  providers: [PreciosService, PedidosService, RemitosService, OrigenesVenta, PercepcionesVentaService, ComprobantesVentaService, EmisionService, AplicacionesService, RecibosService, ConsultasVentasService, VendedoresService, ComisionesCalculoService, LiquidacionesComisionesService, GestionesService, AgendaCobranzasService, ConfigInteresesService, InteresesCalculoService, LiquidacionesInteresesService, MailCobranzasService, ObligacionFceService, FceRegistroService],
  exports: [ComprobantesVentaService, EmisionService, AplicacionesService],
})
export class VentasModule {}
