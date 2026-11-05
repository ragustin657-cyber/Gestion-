import { Paper, Tabs, Title } from '@mantine/core';
import { estado, Maestro } from '../abm/Maestro';
import { CampoAbm } from '../abm/tipos';

interface Registro { id: string; codigo: string; nombre: string; direccion?: string | null; activo: boolean }
const base: CampoAbm[] = [
  { nombre: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true },
  { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
];
const activo: CampoAbm = { nombre: 'activo', etiqueta: 'Activo', tipo: 'booleano' };

export function OrganizacionPage() {
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Centros de costo y depósitos</Title>
      <Tabs defaultValue="centros" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="centros">Centros de costo</Tabs.Tab>
          <Tabs.Tab value="depositos">Depósitos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="centros">
          <Maestro<Registro> sinMarco config={{
            titulo: 'Centro de costo', ruta: '/centros-costo', permisoEditar: 'organizacion.editar', valoresNuevos: { activo: true },
            campos: [...base, activo],
            columnas: [{ campo: 'codigo', titulo: 'Código' }, { campo: 'nombre', titulo: 'Nombre' }, { campo: 'activo', titulo: 'Estado', render: (r) => estado(r.activo) }],
          }} />
        </Tabs.Panel>
        <Tabs.Panel value="depositos">
          <Maestro<Registro> sinMarco config={{
            titulo: 'Depósito', ruta: '/depositos', permisoEditar: 'organizacion.editar', valoresNuevos: { activo: true },
            campos: [...base, { nombre: 'direccion', etiqueta: 'Dirección', tipo: 'texto', ancho: true }, activo],
            columnas: [
              { campo: 'codigo', titulo: 'Código' }, { campo: 'nombre', titulo: 'Nombre' }, { campo: 'direccion', titulo: 'Dirección' },
              { campo: 'activo', titulo: 'Estado', render: (r) => estado(r.activo) },
            ],
          }} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
