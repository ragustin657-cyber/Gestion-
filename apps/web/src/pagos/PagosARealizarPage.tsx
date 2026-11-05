import { Badge, Paper, ScrollArea, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { numeroOP } from './tipos';

interface Respuesta {
  comprobantes: { movimientoId: string; razonSocial: string; comprobante: string; fechaVencimiento: string; monedaCodigo: string; saldo: string; saldoPesos: string; vencido: boolean }[];
  ordenesAprobadas: { id: string; numero: number; razonSocial: string; netoPagar: string; fecha: string }[];
}

export function PagosARealizarPage() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({ queryKey: ['/pagos/pagos-a-realizar', fecha], queryFn: () => api<Respuesta>('/pagos/pagos-a-realizar', { query: { fecha } }) });
  const d = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Pagos a realizar</Title>
      <TextInput label="Fecha de referencia" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} mb="md" />
      <Title order={5} mb="xs">Órdenes de pago aprobadas sin pagar</Title>
      <Table withTableBorder striped mb="lg">
        <Table.Thead><Table.Tr><Table.Th>OP</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th ta="right">Neto a pagar</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(d?.ordenesAprobadas ?? []).map((o) => (
            <Table.Tr key={o.id}><Table.Td>{numeroOP(o.numero)}</Table.Td><Table.Td>{formatoFecha(o.fecha)}</Table.Td><Table.Td>{o.razonSocial}</Table.Td><Table.Td ta="right">{formatoMoneda(o.netoPagar)}</Table.Td></Table.Tr>
          ))}
          {!d?.ordenesAprobadas.length && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" size="sm" ta="center">Sin órdenes aprobadas</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Title order={5} mb="xs">Comprobantes con saldo</Title>
      <ScrollArea>
        <Table withTableBorder striped miw={700}>
          <Table.Thead><Table.Tr><Table.Th>Vencimiento</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th ta="right">En pesos</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(d?.comprobantes ?? []).map((c) => (
              <Table.Tr key={c.movimientoId}>
                <Table.Td>{formatoFecha(c.fechaVencimiento)} {c.vencido && <Badge size="xs" color="red" variant="light">Vencido</Badge>}</Table.Td>
                <Table.Td>{c.razonSocial}</Table.Td><Table.Td>{c.comprobante}</Table.Td>
                <Table.Td ta="right">{formatoMoneda(c.saldo, c.monedaCodigo)}</Table.Td><Table.Td ta="right">{formatoMoneda(c.saldoPesos)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
