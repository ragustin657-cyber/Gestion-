import { estado, Maestro } from '../abm/Maestro';
import { useOpciones } from '../abm/opciones';

interface Usuario { id: string; email: string; nombre: string; rolId: string; rol: string; activo: boolean }

export function UsuariosPage() {
  const roles = useOpciones<{ id: string; nombre: string }>('/roles', (r) => ({ value: r.id, label: r.nombre }));
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
        ],
        camposEdicion: [
          { nombre: 'rolId', etiqueta: 'Rol', tipo: 'select', requerido: true, opciones: roles },
          { nombre: 'activo', etiqueta: 'Activo en esta empresa', tipo: 'booleano' },
        ],
        columnas: [
          { campo: 'nombre', titulo: 'Nombre' },
          { campo: 'email', titulo: 'Email' },
          { campo: 'rol', titulo: 'Rol' },
          { campo: 'activo', titulo: 'Estado', render: (u) => estado(u.activo) },
        ],
      }}
    />
  );
}
