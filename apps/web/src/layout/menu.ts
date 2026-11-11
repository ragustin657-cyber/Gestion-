import type { Permiso } from '@gestion/shared';

export interface NodoMenu {
  titulo: string;
  ruta?: string;
  permiso?: Permiso;
  proximamente?: boolean;
  /** Solo para el administrador general del sistema. */
  soloSuperadmin?: boolean;
  hijos?: NodoMenu[];
}

export const MENU: NodoMenu[] = [
  {
    titulo: 'Registraciones',
    hijos: [
      {
        titulo: 'Compras y Cuentas a Pagar',
        hijos: [
          { titulo: 'Orden de compra', ruta: '/compras/oc/nueva', permiso: 'oc.crear' },
          { titulo: 'Aprobación de OC', ruta: '/compras/oc/aprobacion', permiso: 'oc.aprobar' },
          { titulo: 'Informe de recepción', ruta: '/compras/recepcion', permiso: 'ir.crear' },
          { titulo: 'Factura de proveedor', ruta: '/compras/factura', permiso: 'fc.crear' },
        ],
      },
      {
        titulo: 'Pagos',
        hijos: [
          { titulo: 'Orden de pago', ruta: '/pagos/op/nueva', permiso: 'op.crear' },
          { titulo: 'Aprobación de OP', ruta: '/pagos/op/aprobacion', permiso: 'op.aprobar' },
          { titulo: 'Pago de OP', ruta: '/pagos/pago', permiso: 'pago.ejecutar' },
        ],
      },
      {
        titulo: 'Ventas y Cuentas a Cobrar',
        hijos: [
          { titulo: 'Comprobante de venta', ruta: '/ventas/comprobante', permiso: 'venta.emitir' },
          { titulo: 'Recibo', ruta: '/ventas/recibo', permiso: 'cobro.registrar' },
          { titulo: 'Aplicación de cobros', ruta: '/ventas/aplicacion', permiso: 'cobro.registrar' },
        ],
      },
      {
        titulo: 'Tesorería',
        hijos: [
          { titulo: 'Ingreso de valores', ruta: '/tesoreria/ingreso', permiso: 'tesoreria.operar' },
          { titulo: 'Traslado de valores', ruta: '/tesoreria/traslado', permiso: 'tesoreria.operar' },
          { titulo: 'Recepción de traslados', ruta: '/tesoreria/recepcion', permiso: 'tesoreria.aceptar' },
          { titulo: 'Depósito', ruta: '/tesoreria/deposito', permiso: 'tesoreria.operar' },
          { titulo: 'Acreditaciones', ruta: '/tesoreria/acreditaciones', permiso: 'tesoreria.aceptar' },
          { titulo: 'Rechazo de cheques', ruta: '/tesoreria/rechazo', permiso: 'tesoreria.aceptar' },
          { titulo: 'Débito de cheques propios', ruta: '/tesoreria/debito', permiso: 'tesoreria.aceptar' },
          { titulo: 'Movimientos bancarios', ruta: '/tesoreria/movimientos-bancarios', permiso: 'tesoreria.aceptar' },
          { titulo: 'Transferencias entre cuentas', ruta: '/tesoreria/transferencias', permiso: 'tesoreria.aceptar' },
          { titulo: 'Movimientos de caja', ruta: '/tesoreria/movimientos-caja', permiso: 'tesoreria.operar' },
          { titulo: 'Arqueo', ruta: '/tesoreria/arqueo', permiso: 'tesoreria.operar' },
          { titulo: 'Conciliación bancaria', ruta: '/conciliacion', permiso: 'conciliacion.operar' },
        ],
      },
      {
        titulo: 'Contabilidad General',
        hijos: [
          { titulo: 'Asiento manual', ruta: '/contabilidad/asiento', permiso: 'asiento.registrar' },
          { titulo: 'Períodos y ejercicios', ruta: '/contabilidad/periodos', permiso: 'plancuentas.ver' },
        ],
      },
      {
        titulo: 'Impuestos',
        hijos: [
          { titulo: 'Generar presentación', ruta: '/impuestos/generar', permiso: 'impuestos.presentar' },
          { titulo: 'Control con ARCA', ruta: '/impuestos/control-arca', permiso: 'impuestos.presentar' },
        ],
      },
    ],
  },
  {
    titulo: 'Consultas',
    hijos: [
      {
        titulo: 'Compras y Cuentas a Pagar',
        hijos: [
          { titulo: 'Órdenes de compra', ruta: '/compras/oc', permiso: 'oc.ver' },
          { titulo: 'Recepciones', ruta: '/compras/recepciones', permiso: 'ir.ver' },
          { titulo: 'Comprobantes de compra', ruta: '/compras/comprobantes', permiso: 'fc.ver' },
          { titulo: 'Cuenta corriente de proveedores', ruta: '/compras/cuenta-corriente', permiso: 'fc.ver' },
          { titulo: 'Antigüedad de deuda', ruta: '/compras/antiguedad-deuda', permiso: 'fc.ver' },
          { titulo: 'Libro IVA Compras', ruta: '/compras/libro-iva', permiso: 'fc.ver' },
          { titulo: 'Buscador de comprobantes', ruta: '/compras/buscador', permiso: 'oc.ver' },
          { titulo: 'Pendientes', ruta: '/compras/pendientes', permiso: 'oc.ver' },
        ],
      },
      {
        titulo: 'Pagos',
        hijos: [
          { titulo: 'Órdenes de pago', ruta: '/pagos/op', permiso: 'op.ver' },
          { titulo: 'Pagos a realizar', ruta: '/pagos/a-realizar', permiso: 'op.ver' },
          { titulo: 'Retenciones practicadas', ruta: '/pagos/retenciones', permiso: 'op.ver' },
        ],
      },
      {
        titulo: 'Ventas y Cuentas a Cobrar',
        hijos: [
          { titulo: 'Comprobantes de venta', ruta: '/ventas/comprobantes', permiso: 'venta.ver' },
          { titulo: 'Recibos', ruta: '/ventas/recibos', permiso: 'venta.ver' },
          { titulo: 'Cuenta corriente de clientes', ruta: '/ventas/cuenta-corriente', permiso: 'venta.ver' },
          { titulo: 'Saldos de clientes', ruta: '/ventas/saldos', permiso: 'venta.ver' },
        ],
      },
      {
        titulo: 'Tesorería',
        hijos: [
          { titulo: 'Saldos', ruta: '/tesoreria/saldos', permiso: 'tesoreria.ver' },
          { titulo: 'Cartera de cheques', ruta: '/tesoreria/cartera', permiso: 'tesoreria.ver' },
          { titulo: 'Valores en tránsito', ruta: '/tesoreria/en-transito', permiso: 'tesoreria.ver' },
          { titulo: 'Pendientes de acreditar', ruta: '/tesoreria/pendientes', permiso: 'tesoreria.ver' },
          { titulo: 'Cheques propios', ruta: '/tesoreria/cheques-propios', permiso: 'tesoreria.ver' },
          { titulo: 'Movimientos de cuenta o caja', ruta: '/tesoreria/movimientos', permiso: 'tesoreria.ver' },
          { titulo: 'Flujo de fondos', ruta: '/tesoreria/flujo', permiso: 'tesoreria.ver' },
        ],
      },
      {
        titulo: 'Contabilidad General',
        hijos: [
          { titulo: 'Libro Diario', ruta: '/contabilidad/diario', permiso: 'plancuentas.ver' },
          { titulo: 'Mayor', ruta: '/contabilidad/mayor', permiso: 'plancuentas.ver' },
          { titulo: 'Balance de sumas y saldos', ruta: '/contabilidad/sumas-saldos', permiso: 'plancuentas.ver' },
          { titulo: 'Estado de situación patrimonial', ruta: '/contabilidad/situacion', permiso: 'plancuentas.ver' },
          { titulo: 'Estado de resultados', ruta: '/contabilidad/resultados', permiso: 'plancuentas.ver' },
          { titulo: 'Libros legales', ruta: '/contabilidad/libros', permiso: 'contabilidad.cerrar' },
        ],
      },
      {
        titulo: 'Impuestos',
        hijos: [
          { titulo: 'Libro IVA Ventas', ruta: '/impuestos/libro-iva-ventas', permiso: 'impuestos.ver' },
          { titulo: 'Libro IVA Compras', ruta: '/impuestos/libro-iva-compras', permiso: 'impuestos.ver' },
          { titulo: 'Presentaciones', ruta: '/impuestos/presentaciones', permiso: 'impuestos.ver' },
        ],
      },
    ],
  },
  {
    titulo: 'Maestros',
    hijos: [
      { titulo: 'Proveedores y clientes', ruta: '/maestros/terceros', permiso: 'tercero.ver' },
      { titulo: 'Artículos', ruta: '/maestros/articulos', permiso: 'articulo.ver' },
      { titulo: 'Plan de cuentas', ruta: '/maestros/plan-cuentas', permiso: 'plancuentas.ver' },
      { titulo: 'Monedas y cotizaciones', ruta: '/maestros/monedas', permiso: 'moneda.editar' },
      { titulo: 'Bancos y cajas', ruta: '/maestros/tesoreria', permiso: 'tesoreria.maestros.editar' },
      { titulo: 'Centros de costo y depósitos', ruta: '/maestros/organizacion', permiso: 'organizacion.editar' },
    ],
  },
  {
    titulo: 'Administración del sistema',
    hijos: [
      { titulo: 'Empresa', ruta: '/admin/empresa', permiso: 'empresa.administrar' },
      { titulo: 'Usuarios', ruta: '/admin/usuarios', permiso: 'usuario.administrar' },
      { titulo: 'Roles', ruta: '/admin/roles', permiso: 'rol.administrar' },
      { titulo: 'Auditoría', ruta: '/admin/auditoria', permiso: 'auditoria.ver' },
      { titulo: 'Configuración de compras', ruta: '/admin/compras', permiso: 'compras.config' },
      { titulo: 'Factura electrónica ARCA', ruta: '/admin/arca', permiso: 'arca.configurar' },
      { titulo: 'Configuración de impuestos', ruta: '/admin/impuestos', permiso: 'impuestos.presentar' },
      { titulo: 'Retenciones', ruta: '/admin/retenciones', permiso: 'retenciones.config' },
      { titulo: 'Reglas de conciliación', ruta: '/admin/reglas-conciliacion', permiso: 'conciliacion.operar' },
      { titulo: 'Padrones de IIBB', ruta: '/admin/padrones', soloSuperadmin: true },
    ],
  },
];

/** Quita hojas sin permiso y ramas que quedan vacías (las "Próximamente" se conservan). */
export function filtrarMenu(menu: NodoMenu[], permisos: Permiso[], superadmin = false): NodoMenu[] {
  const r: NodoMenu[] = [];
  for (const n of menu) {
    if (n.hijos) {
      const hijos = filtrarMenu(n.hijos, permisos, superadmin);
      if (hijos.length) r.push({ ...n, hijos });
    } else if (n.soloSuperadmin) {
      if (superadmin) r.push(n);
    } else if (n.proximamente || !n.permiso || permisos.includes(n.permiso)) {
      r.push(n);
    }
  }
  return r;
}
