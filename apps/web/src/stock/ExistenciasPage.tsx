import { ActionIcon, Button, Checkbox, Group, Modal, Paper, Select, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconListDetails } from '@tabler/icons-react';
import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { cantidadTexto, useDepositos, useExistencias } from './comun';

export function ExistenciasPage() {
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [solo, setSolo] = useState(true);
  const query = { depositoId: depositoId ?? undefined, soloConStock: solo ? 'true' : undefined };
  const q = useExistencias(query);
  const depositos = (useDepositos().data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  // E53: pedidos que reservan un artículo
  const [reservasDe, setReservasDe] = useState<{ articuloId: string; codigo: string } | null>(null);
  const reservas = useQuery({
    queryKey: ['/stock/reservas', reservasDe?.articuloId, depositoId],
    queryFn: () => api<{ pedidoId: string; pedido: number; fecha: string; cliente: string; deposito: string; cantidad: string }[]>('/stock/reservas', { query: { articuloId: reservasDe!.articuloId, depositoId: depositoId ?? undefined } }),
    enabled: !!reservasDe,
  });
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
        <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Depósitos</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Reservado</Table.Th><Table.Th ta="right">Disponible</Table.Th><Table.Th ta="right">Costo promedio</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data?.filas ?? []).map((f) => (
            <Table.Tr key={f.articuloId}>
              <Table.Td>{f.codigo} {f.descripcion}</Table.Td>
              <Table.Td><Text size="sm">{f.depositos.map((d) => `${d.nombre}: ${cantidadTexto(d.cantidad)}`).join(' · ')}</Text></Table.Td>
              <Table.Td ta="right">{cantidadTexto(f.cantidad)} {f.unidad}</Table.Td>
              <Table.Td ta="right"><Group gap={2} justify="flex-end" wrap="nowrap">{cantidadTexto(f.reservado ?? '0')}
                {Number(f.reservado ?? 0) > 0 && <ActionIcon size="sm" variant="subtle" aria-label={`Reservas de ${f.codigo}`} onClick={() => setReservasDe({ articuloId: f.articuloId, codigo: f.codigo })}><IconListDetails size={14} /></ActionIcon>}</Group></Table.Td>
              <Table.Td ta="right"><Text size="sm" c={Number(f.disponible ?? 0) < 0 ? 'red' : undefined}>{cantidadTexto(f.disponible ?? f.cantidad)}</Text></Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.costoPromedio)}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(f.valor)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot><Table.Tr><Table.Th colSpan={6}>Total</Table.Th><Table.Th ta="right">{formatoMoneda(q.data?.total ?? '0')}</Table.Th></Table.Tr></Table.Tfoot>
      </Table>
      <Modal opened={!!reservasDe} onClose={() => setReservasDe(null)} title={`Reservas de ${reservasDe?.codigo ?? ''}`} size="lg">
        <Table withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>Pedido</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Depósito</Table.Th><Table.Th ta="right">Reservado</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(reservas.data ?? []).map((r) => <Table.Tr key={`${r.pedidoId}${r.deposito}`}><Table.Td>{`Pedido ${r.pedido}`}</Table.Td><Table.Td>{formatoFecha(r.fecha)}</Table.Td><Table.Td>{r.cliente}</Table.Td><Table.Td>{r.deposito}</Table.Td><Table.Td ta="right">{cantidadTexto(r.cantidad)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </Modal>
    </Paper>
  );
}
