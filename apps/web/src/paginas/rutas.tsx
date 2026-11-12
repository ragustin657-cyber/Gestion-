import { ReactNode } from 'react';
import { ConfigComprasPage } from '../compras/ConfigComprasPage';
import { AntiguedadDeudaPage } from '../compras/consultas/AntiguedadDeudaPage';
import { BuscadorComprobantesPage } from '../compras/consultas/BuscadorComprobantesPage';
import { ComprobantesCompraPage } from '../compras/consultas/ComprobantesCompraPage';
import { CuentaCorrientePage } from '../compras/consultas/CuentaCorrientePage';
import { LibroIvaComprasPage } from '../compras/consultas/LibroIvaComprasPage';
import { PendientesPage } from '../compras/consultas/PendientesPage';
import { RecepcionesPage } from '../compras/consultas/RecepcionesPage';
import { FacturaProveedorPage } from '../compras/FacturaProveedorPage';
import { OrdenCompraPage } from '../compras/OrdenCompraPage';
import { RecepcionPage } from '../compras/RecepcionPage';
import { AprobacionOcPage, OrdenesCompraPage } from '../compras/OrdenesCompraPage';
import { OrdenPagoPage } from '../pagos/OrdenPagoPage';
import { PagoOpPage } from '../pagos/PagoOpPage';
import { ConfigRetencionesPage } from '../pagos/ConfigRetencionesPage';
import { PadronesPage } from '../pagos/PadronesPage';
import { PagosARealizarPage } from '../pagos/PagosARealizarPage';
import { RetencionesPage } from '../pagos/RetencionesPage';
import { AprobacionOpPage, OrdenesPagoPage } from '../pagos/OrdenesPagoPage';
import { ArqueoPage, MovimientosBancariosPage, MovimientosCajaPage, TransferenciasInternasPage } from '../tesoreria/BancosCajasPages';
import { CarteraPage, ChequesPropiosPage, DebitoChequesPropiosPage, RechazoChequesPage } from '../tesoreria/ChequesPages';
import { FlujoFondosPage, MovimientosCuentaPage, SaldosPage } from '../tesoreria/ConsultasPages';
import { AcreditacionesPage, DepositoPage, PendientesAcreditarPage } from '../tesoreria/DepositosPages';
import { IngresoValoresPage } from '../tesoreria/IngresoValoresPage';
import { RecepcionTrasladosPage, TrasladoPage, ValoresEnTransitoPage } from '../tesoreria/TrasladosPages';
import { ConciliacionesPage } from '../conciliacion/ConciliacionesPage';
import { ConciliacionPage } from '../conciliacion/ConciliacionPage';
import { ReglasPage } from '../conciliacion/ReglasPage';
import { AsientoManualPage } from '../contabilidad/AsientoManualPage';
import { AplicacionPage } from '../ventas/AplicacionPage';
import { ComprobanteVentaPage } from '../ventas/ComprobanteVentaPage';
import { ConfigArcaPage } from '../ventas/ConfigArcaPage';
import { ComprobantesVentaPage, CuentaCorrienteClientesPage, RecibosPage, SaldosClientesPage } from '../ventas/ConsultasVentasPages';
import { ReciboPage } from '../ventas/ReciboPage';
import { ConfigImpuestosPage } from '../impuestos/ConfigImpuestosPage';
import { ConfigStockPage } from '../stock/ConfigStockPage';
import { ListasPreciosPage } from '../ventas/ListasPreciosPage';
import { PedidoVentaPage } from '../ventas/PedidoVentaPage';
import { PedidosPage, RemitosPage as RemitosConsultaPage } from '../ventas/PedidosRemitosPages';
import { RemitoPage } from '../ventas/RemitoPage';
import { DocumentoStockPage } from '../stock/DocumentoStockPage';
import { DocumentosStockPage } from '../stock/DocumentosStockPage';
import { ExistenciasPage } from '../stock/ExistenciasPage';
import { KardexPage } from '../stock/KardexPage';
import { ValuacionPage } from '../stock/ValuacionPage';
import { AjusteInflacionPage } from '../contabilidad/ajuste-inflacion/AjusteInflacionPage';
import { ConfigAjustePage } from '../contabilidad/ajuste-inflacion/ConfigAjustePage';
import { IndicesInflacionPage } from '../contabilidad/ajuste-inflacion/IndicesInflacionPage';
import { ControlArcaPage } from '../impuestos/ControlArcaPage';
import { LibroIvaComprasPage as LibroIvaComprasImpuestosPage, LibroIvaVentasPage } from '../impuestos/LibrosIvaPages';
import { GenerarPresentacionPage, PresentacionesPage } from '../impuestos/PresentacionesPages';
import { DiarioPage, MayorPage, SumasSaldosPage } from '../contabilidad/ConsultasContablesPages';
import { AsientoPage } from '../contabilidad/DetalleAsiento';
import { ResultadosPage, SituacionPage } from '../contabilidad/EstadosPages';
import { LibrosPage } from '../contabilidad/LibrosPage';
import { PeriodosPage } from '../contabilidad/PeriodosPage';
import { AntiguedadPage, MargenesPage, RotacionPage, VentasInformePage } from '../informes/InformesPages';
import { TableroPage } from '../informes/TableroPage';
import { AmortizacionPage } from '../bienes-uso/AmortizacionPage';
import { BienesPage, FichaBienPage } from '../bienes-uso/BienesPage';
import { PlanillaBienesPage } from '../bienes-uso/PlanillaBienesPage';
import { RubrosPage } from '../bienes-uso/RubrosPage';
import { ArticulosPage } from './ArticulosPage';
import { AuditoriaPage } from './AuditoriaPage';
import { EmpresaPage } from './EmpresaPage';
import { MonedasPage } from './MonedasPage';
import { OrganizacionPage } from './OrganizacionPage';
import { PlanCuentasPage } from './PlanCuentasPage';
import { RolesPage } from './RolesPage';
import { TercerosPage } from './TercerosPage';
import { TesoreriaPage } from './TesoreriaPage';
import { UsuariosPage } from './UsuariosPage';

/** Rutas de las páginas del menú (deben coincidir con MENU). */
export const RUTAS_PAGINAS: { ruta: string; elemento: ReactNode }[] = [
  { ruta: '/maestros/terceros', elemento: <TercerosPage /> },
  { ruta: '/maestros/articulos', elemento: <ArticulosPage /> },
  { ruta: '/maestros/plan-cuentas', elemento: <PlanCuentasPage /> },
  { ruta: '/maestros/monedas', elemento: <MonedasPage /> },
  { ruta: '/maestros/tesoreria', elemento: <TesoreriaPage /> },
  { ruta: '/maestros/organizacion', elemento: <OrganizacionPage /> },
  { ruta: '/admin/empresa', elemento: <EmpresaPage /> },
  { ruta: '/admin/usuarios', elemento: <UsuariosPage /> },
  { ruta: '/admin/roles', elemento: <RolesPage /> },
  { ruta: '/admin/auditoria', elemento: <AuditoriaPage /> },
  { ruta: '/admin/compras', elemento: <ConfigComprasPage /> },
  { ruta: '/compras/oc/nueva', elemento: <OrdenCompraPage key="nueva" /> },
  { ruta: '/compras/oc/aprobacion', elemento: <AprobacionOcPage /> },
  { ruta: '/compras/oc/:id', elemento: <OrdenCompraPage /> },
  { ruta: '/compras/oc', elemento: <OrdenesCompraPage /> },
  { ruta: '/compras/recepcion', elemento: <RecepcionPage /> },
  { ruta: '/compras/factura', elemento: <FacturaProveedorPage /> },
  { ruta: '/compras/recepciones', elemento: <RecepcionesPage /> },
  { ruta: '/compras/comprobantes', elemento: <ComprobantesCompraPage /> },
  { ruta: '/compras/cuenta-corriente', elemento: <CuentaCorrientePage /> },
  { ruta: '/compras/antiguedad-deuda', elemento: <AntiguedadDeudaPage /> },
  { ruta: '/compras/libro-iva', elemento: <LibroIvaComprasPage /> },
  { ruta: '/compras/buscador', elemento: <BuscadorComprobantesPage /> },
  { ruta: '/compras/pendientes', elemento: <PendientesPage /> },
  { ruta: '/pagos/op/nueva', elemento: <OrdenPagoPage key="nueva" /> },
  { ruta: '/pagos/op/aprobacion', elemento: <AprobacionOpPage /> },
  { ruta: '/pagos/op/:id', elemento: <OrdenPagoPage /> },
  { ruta: '/pagos/op', elemento: <OrdenesPagoPage /> },
  { ruta: '/pagos/pago', elemento: <PagoOpPage /> },
  { ruta: '/pagos/a-realizar', elemento: <PagosARealizarPage /> },
  { ruta: '/pagos/retenciones', elemento: <RetencionesPage /> },
  { ruta: '/admin/retenciones', elemento: <ConfigRetencionesPage /> },
  { ruta: '/admin/padrones', elemento: <PadronesPage /> },
  { ruta: '/tesoreria/ingreso', elemento: <IngresoValoresPage /> },
  { ruta: '/tesoreria/traslado', elemento: <TrasladoPage /> },
  { ruta: '/tesoreria/recepcion', elemento: <RecepcionTrasladosPage /> },
  { ruta: '/tesoreria/deposito', elemento: <DepositoPage /> },
  { ruta: '/tesoreria/acreditaciones', elemento: <AcreditacionesPage /> },
  { ruta: '/tesoreria/rechazo', elemento: <RechazoChequesPage /> },
  { ruta: '/tesoreria/debito', elemento: <DebitoChequesPropiosPage /> },
  { ruta: '/tesoreria/movimientos-bancarios', elemento: <MovimientosBancariosPage /> },
  { ruta: '/tesoreria/transferencias', elemento: <TransferenciasInternasPage /> },
  { ruta: '/tesoreria/movimientos-caja', elemento: <MovimientosCajaPage /> },
  { ruta: '/tesoreria/arqueo', elemento: <ArqueoPage /> },
  { ruta: '/tesoreria/saldos', elemento: <SaldosPage /> },
  { ruta: '/tesoreria/cartera', elemento: <CarteraPage /> },
  { ruta: '/tesoreria/en-transito', elemento: <ValoresEnTransitoPage /> },
  { ruta: '/tesoreria/pendientes', elemento: <PendientesAcreditarPage /> },
  { ruta: '/tesoreria/cheques-propios', elemento: <ChequesPropiosPage /> },
  { ruta: '/tesoreria/movimientos', elemento: <MovimientosCuentaPage /> },
  { ruta: '/tesoreria/flujo', elemento: <FlujoFondosPage /> },
  { ruta: '/conciliacion', elemento: <ConciliacionesPage /> },
  { ruta: '/conciliacion/:id', elemento: <ConciliacionPage /> },
  { ruta: '/admin/reglas-conciliacion', elemento: <ReglasPage /> },
  { ruta: '/contabilidad/asiento', elemento: <AsientoManualPage /> },
  { ruta: '/contabilidad/periodos', elemento: <PeriodosPage /> },
  { ruta: '/contabilidad/diario', elemento: <DiarioPage /> },
  { ruta: '/contabilidad/mayor', elemento: <MayorPage /> },
  { ruta: '/contabilidad/sumas-saldos', elemento: <SumasSaldosPage /> },
  { ruta: '/contabilidad/situacion', elemento: <SituacionPage /> },
  { ruta: '/contabilidad/resultados', elemento: <ResultadosPage /> },
  { ruta: '/contabilidad/libros', elemento: <LibrosPage /> },
  { ruta: '/contabilidad/asientos/:id', elemento: <AsientoPage /> },
  { ruta: '/ventas/comprobante', elemento: <ComprobanteVentaPage /> },
  { ruta: '/ventas/recibo', elemento: <ReciboPage /> },
  { ruta: '/ventas/aplicacion', elemento: <AplicacionPage /> },
  { ruta: '/ventas/aplicaciones', elemento: <AplicacionPage /> },
  { ruta: '/ventas/comprobantes', elemento: <ComprobantesVentaPage /> },
  { ruta: '/ventas/recibos', elemento: <RecibosPage /> },
  { ruta: '/ventas/cuenta-corriente', elemento: <CuentaCorrienteClientesPage /> },
  { ruta: '/ventas/saldos', elemento: <SaldosClientesPage /> },
  { ruta: '/admin/arca', elemento: <ConfigArcaPage /> },
  { ruta: '/impuestos/generar', elemento: <GenerarPresentacionPage /> },
  { ruta: '/impuestos/control-arca', elemento: <ControlArcaPage /> },
  { ruta: '/impuestos/libro-iva-ventas', elemento: <LibroIvaVentasPage /> },
  { ruta: '/impuestos/libro-iva-compras', elemento: <LibroIvaComprasImpuestosPage /> },
  { ruta: '/impuestos/presentaciones', elemento: <PresentacionesPage /> },
  { ruta: '/admin/impuestos', elemento: <ConfigImpuestosPage /> },
  { ruta: '/admin/indices-inflacion', elemento: <IndicesInflacionPage /> },
  { ruta: '/admin/stock', elemento: <ConfigStockPage /> },
  { ruta: '/maestros/listas-precios', elemento: <ListasPreciosPage /> },
  { ruta: '/ventas/pedido', elemento: <PedidoVentaPage /> },
  { ruta: '/ventas/remito', elemento: <RemitoPage /> },
  { ruta: '/ventas/pedidos', elemento: <PedidosPage /> },
  { ruta: '/ventas/remitos', elemento: <RemitosConsultaPage /> },
  { ruta: '/stock/transferencia', elemento: <DocumentoStockPage key="t" tipo="TRANSFERENCIA" /> },
  { ruta: '/stock/inventario', elemento: <DocumentoStockPage key="i" tipo="INVENTARIO" /> },
  { ruta: '/stock/inicial', elemento: <DocumentoStockPage key="n" tipo="INICIAL" /> },
  { ruta: '/stock/salida', elemento: <DocumentoStockPage key="s" tipo="SALIDA" /> },
  { ruta: '/stock/documentos', elemento: <DocumentosStockPage /> },
  { ruta: '/stock/existencias', elemento: <ExistenciasPage /> },
  { ruta: '/stock/kardex', elemento: <KardexPage /> },
  { ruta: '/stock/valuacion', elemento: <ValuacionPage /> },
  { ruta: '/admin/ajuste-inflacion', elemento: <ConfigAjustePage /> },
  { ruta: '/contabilidad/ajuste-inflacion', elemento: <AjusteInflacionPage /> },
  { ruta: '/maestros/rubros-bienes', elemento: <RubrosPage /> },
  { ruta: '/contabilidad/bienes', elemento: <BienesPage /> },
  { ruta: '/contabilidad/bienes/:id', elemento: <FichaBienPage /> },
  { ruta: '/contabilidad/amortizacion', elemento: <AmortizacionPage /> },
  { ruta: '/contabilidad/planilla-bienes', elemento: <PlanillaBienesPage /> },
  { ruta: '/informes/tablero', elemento: <TableroPage /> },
  { ruta: '/informes/ventas', elemento: <VentasInformePage /> },
  { ruta: '/informes/margenes', elemento: <MargenesPage /> },
  { ruta: '/informes/antiguedad', elemento: <AntiguedadPage /> },
  { ruta: '/informes/rotacion', elemento: <RotacionPage /> },
];
