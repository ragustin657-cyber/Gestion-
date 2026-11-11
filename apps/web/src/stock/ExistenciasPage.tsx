import { Button, Checkbox, Group, Paper, Select, Table, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { cantidadTexto, useDepositos, useExistencias } from './comun';

export function ExistenciasPage() {
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [solo, setSolo] = useState(true);
  const query = { depositoId: depositoId ?? undefined, soloConStock: solo ? 'true' : undefined };
  const q = useExistencias(query);
  const depositos = (useDepositos().data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Existencias</Title>
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/existencias', { ...query, formato: 'xlsx' }, 'existencias.xlsx')}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/existencias', { ...query, formato: 'pdf' }, 'existencias.pdf')}>PDF</Button>
        </Group>
      </Group>
      <Group align="flex-end" mb="md">
        <Select label="Depósito" w={240} clearable placeholder="Todos" data={depositos} value={depositoId} onChange={setDepositoId} />
        <Checkbox label="Solo con stock" checked={solo} onChange={(e) => setSolo(e.currentTarget.checked)} mb={8} />
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Depósitos</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Costo promedio</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data?.filas ?? []).map((f) => (
            <Table.Tr key={f.articuloId}>
              <Table.Td>{f.codigo} {f.descripcion}</Table.Td>
              <Table.Td><Text size="sm">{f.depositos.map((d) => `${d.nombre}: ${cantidadTexto(d.cantidad)}`).join(' · ')}</Text></Table.Td>
              <Table.Td ta="right">{cantidadTexto(f.cantidad)} {f.unidad}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.costoPromedio)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.valor)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot><Table.Tr><Table.Th colSpan={4}>Total</Table.Th><Table.Th ta="right">{formatoMoneda(q.data?.total ?? '0')}</Table.Th></Table.Tr></Table.Tfoot>
      </Table>
    </Paper>
  );
}
