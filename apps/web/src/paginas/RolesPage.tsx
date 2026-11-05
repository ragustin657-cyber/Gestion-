import { PERMISOS, Permiso, TODOS_LOS_PERMISOS } from '@gestion/shared';
import { Maestro } from '../abm/Maestro';

interface Rol { id: string; nombre: string; permisos: Permiso[] }

const GRUPOS: Record<string, string> = {
  empresa: 'Administración', usuario: 'Administración', rol: 'Administración', auditoria: 'Administración',
  tercero: 'Maestros', articulo: 'Maestros', moneda: 'Maestros', organizacion: 'Maestros',
  plancuentas: 'Contabilidad', tesoreria: 'Tesorería', pago: 'Tesorería',
  oc: 'Compras', ir: 'Compras', fc: 'Compras', op: 'Pagos',
};
const OPCIONES = TODOS_LOS_PERMISOS.map((p) => ({ value: p, label: PERMISOS[p], grupo: GRUPOS[p.split('.')[0]] ?? 'Otros' }));

export function RolesPage() {
  const campos = [
    { nombre: 'nombre', etiqueta: 'Nombre del rol', tipo: 'texto' as const, requerido: true },
    { nombre: 'permisos', etiqueta: 'Permisos', tipo: 'checkboxes' as const, opciones: OPCIONES },
  ];
  return (
    <Maestro<Rol>
      config={{
        titulo: 'Roles',
        ruta: '/roles',
        permisoEditar: 'rol.administrar',
        valoresNuevos: { permisos: [] },
        campos,
        columnas: [
          { campo: 'nombre', titulo: 'Rol' },
          { campo: 'permisos', titulo: 'Permisos', render: (r) => `${r.permisos.length} de ${TODOS_LOS_PERMISOS.length}` },
        ],
      }}
    />
  );
}
