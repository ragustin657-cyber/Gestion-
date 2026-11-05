import { Badge, Group, Paper, Select, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { TablaAbm } from '../abm/TablaAbm';

interface Registro { id: string; fecha: string; entidad: string; entidadId: string; accion: string; usuarioId: string }
const ENTIDADES = ['Empresa', 'Usuario', 'Rol', 'Tercero', 'Articulo', 'CuentaContable', 'Cotizacion', 'CentroCosto', 'Deposito', 'Banco', 'CuentaBancaria', 'Chequera', 'Caja'];
const COLORES: Record<string, string> = { CREAR: 'green', MODIFICAR: 'blue', APROBAR: 'teal', ANULAR: 'red', ELIMINAR: 'red' };

export function AuditoriaPage() {
  const [entidad, setEntidad] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Auditoría</Title>
      <Group mb="sm" wrap="wrap">
        <Select placeholder="Entidad" data={ENTIDADES} value={entidad} onChange={setEntidad} clearable w={200} />
        <TextInput type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
      </Group>
      <TablaAbm<Registro>
        ruta="/auditoria"
        buscador={false}
        filtros={{ entidad: entidad ?? undefined, desde: desde || undefined, hasta: hasta ? `${hasta}T23:59:59` : undefined }}
        columnas={[
          { campo: 'fecha', titulo: 'Fecha y hora', render: (r) => new Date(r.fecha).toLocaleString('es-AR') },
          { campo: 'entidad', titulo: 'Entidad' },
          { campo: 'accion', titulo: 'Acción', render: (r) => <Badge size="sm" variant="light" color={COLORES[r.accion]}>{r.accion}</Badge> },
          { campo: 'usuarioId', titulo: 'Usuario', render: (r) => r.usuarioId.slice(0, 8) },
          { campo: 'entidadId', titulo: 'Registro', render: (r) => r.entidadId.slice(0, 8) },
        ]}
      />
    </Paper>
  );
}
