import { estado, Maestro } from '../abm/Maestro';

interface Transportista { id: string; cuit: string; razonSocial: string; patentePorDefecto: string | null; activo: boolean }

/** E57: transportistas para el COT de ARBA. */
export function TransportistasPage() {
  return (
    <Maestro<Transportista>
      config={{
        titulo: 'Transportistas', ruta: '/transportistas', permisoEditar: 'tercero.editar', valoresNuevos: { activo: true },
        campos: [
          { nombre: 'cuit', etiqueta: 'CUIT', tipo: 'texto', requerido: true },
          { nombre: 'razonSocial', etiqueta: 'Razón social', tipo: 'texto', requerido: true },
          { nombre: 'patentePorDefecto', etiqueta: 'Patente por defecto', tipo: 'texto' },
          { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' },
        ],
        columnas: [
          { campo: 'cuit', titulo: 'CUIT' }, { campo: 'razonSocial', titulo: 'Razón social' }, { campo: 'patentePorDefecto', titulo: 'Patente', render: (t) => t.patentePorDefecto ?? '—' },
          { campo: 'activo', titulo: 'Estado', render: (t) => estado(t.activo) },
        ],
      }}
    />
  );
}
