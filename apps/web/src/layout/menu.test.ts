import { filtrarMenu, MENU, NodoMenu } from './menu';

const titulos = (ns: NodoMenu[]) => ns.map((n) => n.titulo);

describe('filtrarMenu', () => {
  it('quita la hoja Usuarios si falta usuario.administrar', () => {
    const m = filtrarMenu(MENU, ['rol.administrar']);
    const admin = m.find((n) => n.titulo === 'Administración del sistema')!;
    expect(titulos(admin.hijos!)).toContain('Roles');
    expect(titulos(admin.hijos!)).not.toContain('Usuarios');
  });

  it('elimina Administración del sistema si no queda ninguna hoja', () => {
    expect(titulos(filtrarMenu(MENU, ['tercero.ver']))).not.toContain('Administración del sistema');
  });

  it('conserva las ramas Próximamente', () => {
    const m = filtrarMenu([{ titulo: 'Módulo futuro', hijos: [{ titulo: 'Próximamente', proximamente: true }] }], []);
    expect(titulos(m)).toEqual(['Módulo futuro']);
  });

  it('con oc.crear, Registraciones › Compras incluye Orden de compra', () => {
    const m = filtrarMenu(MENU, ['oc.crear']);
    const compras = m.find((n) => n.titulo === 'Registraciones')!.hijos!.find((n) => n.titulo === 'Compras y Cuentas a Pagar')!;
    expect(titulos(compras.hijos!)).toContain('Orden de compra');
  });

  it('con venta.emitir, Registraciones › Ventas incluye Comprobante de venta', () => {
    const m = filtrarMenu(MENU, ['venta.emitir']);
    const ventas = m.find((n) => n.titulo === 'Registraciones')!.hijos!.find((n) => n.titulo === 'Ventas y Cuentas a Cobrar')!;
    expect(titulos(ventas.hijos!)).toContain('Comprobante de venta');
  });

  it('con impuestos.presentar, Registraciones › Impuestos tiene Generar presentación y Control con ARCA', () => {
    const m = filtrarMenu(MENU, ['impuestos.presentar']);
    const imp = m.find((n) => n.titulo === 'Registraciones')!.hijos!.find((n) => n.titulo === 'Impuestos')!;
    expect(titulos(imp.hijos!)).toEqual(['Generar presentación', 'Control con ARCA']);
  });

  it('con todos los permisos muestra Maestros completo', () => {
    const m = filtrarMenu(MENU, ['tercero.ver', 'articulo.ver', 'plancuentas.ver', 'moneda.editar', 'tesoreria.maestros.editar', 'organizacion.editar']);
    expect(m.find((n) => n.titulo === 'Maestros')!.hijos).toHaveLength(6);
  });
});

import { RUTAS_PAGINAS } from '../paginas/rutas';

describe('rutas', () => {
  it('cada hoja del menú con ruta tiene su página', () => {
    const hojas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => (n.hijos ? hojas(n.hijos) : n.ruta ? [n.ruta] : []));
    const rutas = RUTAS_PAGINAS.map((r) => r.ruta);
    for (const h of hojas(MENU)) expect(rutas).toContain(h);
  });
});

describe('menú del administrador general', () => {
  const hojas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => (n.hijos ? hojas(n.hijos) : [n.titulo]));
  it('Padrones de IIBB solo aparece para el superadmin', () => {
    expect(hojas(filtrarMenu(MENU, ['retenciones.config']))).not.toContain('Padrones de IIBB');
    expect(hojas(filtrarMenu(MENU, ['retenciones.config'], true))).toContain('Padrones de IIBB');
  });

  it('Índices de inflación solo para el administrador general', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['contabilidad.cerrar']))).not.toContain('Índices de inflación');
    expect(todas(filtrarMenu(MENU, ['contabilidad.cerrar'], true))).toContain('Índices de inflación');
    expect(todas(filtrarMenu(MENU, ['contabilidad.cerrar']))).toContain('Ajuste por inflación');
  });

  it('Stock según permisos', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['stock.ver']))).toContain('Existencias');
    expect(todas(filtrarMenu(MENU, ['stock.ver']))).not.toContain('Inventario físico');
    expect(todas(filtrarMenu(MENU, ['stock.operar']))).toContain('Inventario físico');
    expect(todas(filtrarMenu(MENU, []))).not.toContain('Existencias');
  });

  it('Pedidos, remitos y listas de precios según permisos', () => {
    const todas = (ns: NodoMenu[]): string[] => ns.flatMap((n) => [n.titulo, ...todas(n.hijos ?? [])]);
    expect(todas(filtrarMenu(MENU, ['pedido.gestionar']))).toEqual(expect.arrayContaining(['Pedido de venta', 'Remito']));
    expect(todas(filtrarMenu(MENU, ['precios.editar']))).toContain('Listas de precios');
    expect(todas(filtrarMenu(MENU, ['venta.ver']))).toEqual(expect.arrayContaining(['Pedidos', 'Remitos']));
  });
});
