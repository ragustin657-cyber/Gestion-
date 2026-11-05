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
    const m = filtrarMenu(MENU, []);
    expect(titulos(m)).toEqual(expect.arrayContaining(['Registraciones', 'Consultas']));
  });

  it('con oc.crear, Registraciones › Compras incluye Orden de compra', () => {
    const m = filtrarMenu(MENU, ['oc.crear']);
    const compras = m.find((n) => n.titulo === 'Registraciones')!.hijos!.find((n) => n.titulo === 'Compras y Cuentas a Pagar')!;
    expect(titulos(compras.hijos!)).toContain('Orden de compra');
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
