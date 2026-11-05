import { ReactNode } from 'react';
import { ConfigComprasPage } from '../compras/ConfigComprasPage';
import { OrdenCompraPage } from '../compras/OrdenCompraPage';
import { AprobacionOcPage, OrdenesCompraPage } from '../compras/OrdenesCompraPage';
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
];
