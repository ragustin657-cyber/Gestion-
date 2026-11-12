import { Alert, Button, Group, Paper, Table, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { cantidadTexto } from './comun';

export interface Valuacion { fecha: string; filas: { articuloId: string; codigo: string; descripcion: string; cantidad: string; valor: string }[]; total: string; mayor: string; control: string }

export function ControlValuacion({ valuacion }: { valuacion: Valuacion }) {
  return Number(valuacion.control) === 0
    ? <Alert color="green">Coincide con el Mayor</Alert>
    : <Alert color="orange">{`Diferencia con el Mayor: ${formatoMoneda(valuacion.control)}`}</Alert>;
}

export function ValuacionPage() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({ queryKey: ['/stock/valuacion', fecha], queryFn: () => api<Valuacion>('/stock/valuacion', { query: { fecha } }), enabled: !!fecha });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Valuación de inventario</Title>
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/valuacion', { fecha, formato: 'xlsx' }, `valuacion-${fecha}.xlsx`)}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/valuacion', { fecha, formato: 'pdf' }, `valuacion-${fecha}.pdf`)}>PDF</Button>
        </Group>
      </Group>
      <TextInput label="Al" type="date" w={180} mb="md" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      {errorConsulta(q.error)}
      {q.data && <>
        <Table withTableBorder striped mb="sm">
          <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {q.data.filas.map((f) => <Table.Tr key={f.articuloId}><Table.Td>{f.codigo} {f.descripcion}</Table.Td><Table.Td ta="right">{cantidadTexto(f.cantidad)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.valor)}</Table.Td></Table.Tr>)}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr><Table.Th colSpan={2}>Total</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.total)}</Table.Th></Table.Tr>
            <Table.Tr><Table.Th colSpan={2}>Saldo de Mercaderías en el Mayor</Table.Th><Table.Th ta="right">{formatoMoneda(q.data.mayor)}</Table.Th></Table.Tr>
          </Table.Tfoot>
        </Table>
        <ControlValuacion valuacion={q.data} />
      </>}
    </Paper>
  );
}
