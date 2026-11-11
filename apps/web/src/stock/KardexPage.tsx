import { Button, Group, Paper, Select, Table, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';
import { cantidadTexto, useDepositos, useExistencias } from './comun';

export interface MovimientoKardex {
  id: string; fecha: string; tipo: string; documento: string; anulacion: boolean; entrada: string | null; salida: string | null;
  saldoCantidad: string; costoUnitario: string; importe: string; saldoValor: string | null;
}
export interface Kardex { articulo: { id: string; codigo: string; descripcion: string; unidad: string }; saldoInicial: { cantidad: string; valor: string | null }; movimientos: MovimientoKardex[] }

export function TablaKardex({ kardex }: { kardex: Kardex }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Documento</Table.Th><Table.Th ta="right">Entrada</Table.Th><Table.Th ta="right">Salida</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th ta="right">Costo unitario</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Saldo valor</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        <Table.Tr><Table.Td /><Table.Td>Saldo inicial</Table.Td><Table.Td /><Table.Td /><Table.Td ta="right">{cantidadTexto(kardex.saldoInicial.cantidad)}</Table.Td><Table.Td /><Table.Td /><Table.Td ta="right">{kardex.saldoInicial.valor === null ? '' : formatoMoneda(kardex.saldoInicial.valor)}</Table.Td></Table.Tr>
        {kardex.movimientos.map((m) => (
          <Table.Tr key={m.id}>
            <Table.Td>{formatoFecha(m.fecha)}</Table.Td>
            <Table.Td>{m.documento}{m.anulacion ? ' (anulación)' : ''}</Table.Td>
            <Table.Td ta="right">{cantidadTexto(m.entrada)}</Table.Td>
            <Table.Td ta="right">{cantidadTexto(m.salida)}</Table.Td>
            <Table.Td ta="right">{cantidadTexto(m.saldoCantidad)}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(m.costoUnitario)}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(m.importe)}</Table.Td>
            <Table.Td ta="right">{m.saldoValor === null ? '' : formatoMoneda(m.saldoValor)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function KardexPage() {
  const [articuloId, setArticuloId] = useState<string | null>(null);
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const articulos = (useExistencias().data?.filas ?? []).map((f) => ({ value: f.articuloId, label: `${f.codigo} ${f.descripcion}` }));
  const depositos = (useDepositos().data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  const query = { articuloId: articuloId ?? undefined, depositoId: depositoId ?? undefined, desde: desde || undefined, hasta: hasta || undefined };
  const q = useQuery({ queryKey: ['/stock/kardex', query], queryFn: () => api<Kardex>('/stock/kardex', { query }), enabled: !!articuloId });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Kardex</Title>
        {articuloId && <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/kardex', { ...query, formato: 'xlsx' }, 'kardex.xlsx')}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/stock/kardex', { ...query, formato: 'pdf' }, 'kardex.pdf')}>PDF</Button>
        </Group>}
      </Group>
      <Group align="flex-end" mb="md">
        <Select label="Artículo" w={320} searchable data={articulos} value={articuloId} onChange={setArticuloId} />
        <Select label="Depósito" w={200} clearable placeholder="Todos" data={depositos} value={depositoId} onChange={setDepositoId} />
        <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
      </Group>
      {errorConsulta(q.error)}
      {q.data && <TablaKardex kardex={q.data} />}
    </Paper>
  );
}
