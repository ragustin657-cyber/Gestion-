import { estado, Maestro } from '../abm/Maestro';
import { useOpciones } from '../abm/opciones';

interface Usuario { id: string; email: string; nombre: string; rolId: string; rol: string; activo: boolean; sucursalId: string | null }

export function UsuariosPage() {
  const roles = useOpciones<{ id: string; nombre: string }>('/roles', (r) => ({ value: r.id, label: r.nombre }));
  const sucursales = useOpciones<{ id: string; nombre: string }>('/tesoreria/sucursales', (x) => ({ value: x.id, label: x.nombre }));
  const sucursal = { nombre: 'sucursalId', etiqueta: 'Sucursal', tipo: 'select' as const, opciones: sucursales, ayuda: 'Vacío: opera todas las sucursales.' };
  return (
    <Maestro<Usuario>
      config={{
        titulo: 'Usuarios',
        ruta: '/usuarios',
        permisoEditar: 'usuario.administrar',
        campos: [
          { nombre: 'email', etiqueta: 'Email', tipo: 'texto', requerido: true },
          { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
          { nombre: 'password', etiqueta: 'Contraseña inicial', tipo: 'password', requerido: true, ayuda: 'Si el usuario ya existe en otra empresa, conserva su contraseña.' },
          { nombre: 'rolId', etiqueta: 'Rol', tipo: 'select', requerido: true, opciones: roles },
          sucursal,
        ],
        camposEdicion: [
          { nombre: 'rolId', etiqueta: 'Rol', tipo: 'select', requerido: true, opciones: roles },
          sucursal,
          { nombre: 'activo', etiqueta: 'Activo en esta empresa', tipo: 'booleano' },
          { nombre: 'password', etiqueta: 'Blanquear contraseña', tipo: 'password', ayuda: 'Dejar vacío para no cambiarla.' },
        ],
        columnas: [
          { campo: 'nombre', titulo: 'Nombre' },
          { campo: 'email', titulo: 'Email' },
          { campo: 'rol', titulo: 'Rol' },
          { campo: 'sucursalId', titulo: 'Sucursal', render: (u) => sucursales.find((x) => x.value === u.sucursalId)?.label ?? 'Todas' },
          { campo: 'activo', titulo: 'Estado', render: (u) => estado(u.activo) },
        ],
      }}
    />
  );
}
