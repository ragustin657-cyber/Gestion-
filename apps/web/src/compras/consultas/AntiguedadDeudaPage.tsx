import { Paper, ScrollArea, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/cliente';
import { formatoMoneda, hoy } from '../formato';

interface Fila { terceroId: string; razonSocial: string; porVencer: string; d0a30: string; d31a60: string; d61a90: string; mas90: string; total: string }
const COLS: [keyof Fila, string][] = [['porVencer', 'Por vencer'], ['d0a30', '1 a 30 días'], ['d31a60', '31 a 60'], ['d61a90', '61 a 90'], ['mas90', 'Más de 90'], ['total', 'Total']];

export function AntiguedadDeudaPage() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({ queryKey: ['/compras/antiguedad-deuda', fecha], queryFn: () => api<Fila[]>('/compras/antiguedad-deuda', { query: { fecha } }), enabled: !!fecha });
  const filas = q.data ?? [];
  const total = (k: keyof Fila) => filas.reduce((s, f) => s + Number(f[k]), 0);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Antigüedad de deuda con proveedores</Title>
      <TextInput label="Fecha de corte" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} w={200} mb="md" />
      <ScrollArea>
        <Table withTableBorder striped miw={800}>
          <Table.Thead><Table.Tr><Table.Th>Proveedor</Table.Th>{COLS.map(([, t]) => <Table.Th key={t} ta="right">{t}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>
            {filas.map((f) => (
              <Table.Tr key={f.terceroId}><Table.Td>{f.razonSocial}</Table.Td>{COLS.map(([k]) => <Table.Td key={k} ta="right" fw={k === 'total' ? 700 : undefined}>{formatoMoneda(f[k])}</Table.Td>)}</Table.Tr>
            ))}
            {!filas.length && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center" size="sm">Sin deuda pendiente</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
          {filas.length > 0 && (
            <Table.Tfoot><Table.Tr><Table.Th>Total</Table.Th>{COLS.map(([k]) => <Table.Th key={k} ta="right">{formatoMoneda(total(k))}</Table.Th>)}</Table.Tr></Table.Tfoot>
          )}
        </Table>
      </ScrollArea>
    </Paper>
  );
}
