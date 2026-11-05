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
import { PagosARealizarPage } from '../pagos/PagosARealizarPage';
import { RetencionesPage } from '../pagos/RetencionesPage';
import { AprobacionOpPage, OrdenesPagoPage } from '../pagos/OrdenesPagoPage';
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
];
