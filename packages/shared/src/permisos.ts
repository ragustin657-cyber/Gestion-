export const PERMISOS = {
  'empresa.administrar': 'Administrar datos de la empresa',
  'usuario.administrar': 'Administrar usuarios',
  'rol.administrar': 'Administrar roles',
  'tercero.ver': 'Ver proveedores y clientes',
  'tercero.editar': 'Editar proveedores y clientes',
  'articulo.ver': 'Ver artículos',
  'articulo.editar': 'Editar artículos',
  'plancuentas.ver': 'Ver plan de cuentas',
  'plancuentas.editar': 'Editar plan de cuentas',
  'moneda.editar': 'Editar monedas y cotizaciones',
  'tesoreria.maestros.editar': 'Editar bancos, cuentas, chequeras y cajas',
  'organizacion.editar': 'Editar centros de costo y depósitos',
  'auditoria.ver': 'Ver auditoría',
  'compras.config': 'Configurar compras',
  'oc.ver': 'Ver órdenes de compra',
  'oc.crear': 'Crear órdenes de compra',
  'oc.anular': 'Anular y cerrar órdenes de compra',
  'ir.ver': 'Ver informes de recepción',
  'ir.anular': 'Anular informes de recepción',
  'fc.ver': 'Ver comprobantes de compra',
  'fc.anular': 'Anular comprobantes de compra',
  'oc.aprobar': 'Aprobar órdenes de compra',
  'ir.crear': 'Crear informes de recepción',
  'fc.crear': 'Cargar facturas de proveedores',
  'op.ver': 'Ver órdenes de pago',
  'op.crear': 'Crear órdenes de pago',
  'op.anular': 'Anular órdenes de pago',
  'op.aprobar': 'Aprobar órdenes de pago',
  'pago.ejecutar': 'Ejecutar pagos',
  'retenciones.config': 'Configurar retenciones',
  'tesoreria.ver': 'Ver consultas de tesorería',
  'tesoreria.operar': 'Registrar ingresos, traslados, depósitos y movimientos de caja',
  'tesoreria.aceptar': 'Recibir traslados, acreditar, rechazar y debitar cheques, movimientos bancarios',
  'tesoreria.anular': 'Anular operaciones de tesorería',
  'asiento.registrar': 'Registrar asientos manuales',
  'contabilidad.cerrar': 'Cerrar meses y ejercicios y emitir libros legales',
  'conciliacion.operar': 'Conciliación bancaria: importar extractos, conciliar, registrar y cerrar',
  'venta.emitir': 'Emitir comprobantes de venta',
  'cobro.registrar': 'Registrar recibos y aplicaciones',
  'venta.ver': 'Ver ventas y cuentas corrientes de clientes',
  'arca.configurar': 'Configurar factura electrónica ARCA',
  'impuestos.ver': 'Ver libros IVA y presentaciones',
  'impuestos.presentar': 'Generar presentaciones impositivas y controlar con ARCA',
} as const;

export type Permiso = keyof typeof PERMISOS;

export const TODOS_LOS_PERMISOS = Object.keys(PERMISOS) as Permiso[];

export function esPermiso(p: string): p is Permiso {
  return Object.prototype.hasOwnProperty.call(PERMISOS, p);
}
