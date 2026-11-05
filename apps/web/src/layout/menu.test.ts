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

  it('con todos los permisos muestra Maestros completo', () => {
    const m = filtrarMenu(MENU, ['tercero.ver', 'articulo.ver', 'plancuentas.ver', 'moneda.editar', 'tesoreria.maestros.editar', 'organizacion.editar']);
    expect(m.find((n) => n.titulo === 'Maestros')!.hijos).toHaveLength(6);
  });
});
