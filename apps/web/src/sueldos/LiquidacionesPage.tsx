import { Badge, Button, Group, Modal, Paper, Select, Stack, Table, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { LiquidacionLista, periodoLiquidacion } from './comun';

/** Último día del mes 'AAAA-MM'. */
const finDeMes = (m: string) => { const [a, n] = m.split('-').map(Number); return new Date(Date.UTC(a, n, 0)).toISOString().slice(0, 10); };

export function LiquidacionesPage() {
  const { puede } = useAuth();
  const navegar = useNavigate();
  const op = useOperacion();
  const q = useQuery({ queryKey: ['/sueldos/liquidaciones'], queryFn: () => api<LiquidacionLista[]>('/sueldos/liquidaciones') });
  const [nueva, setNueva] = useState<{ tipo: 'MENSUAL' | 'SAC'; mes: string; fechaPago: string } | null>(null);
  const crear = async () => {
    if (!nueva) return;
    const [anio, mes] = nueva.mes.split('-').map(Number);
    const r = await op.ejecutar(() => api<{ id: string }>('/sueldos/liquidaciones', { metodo: 'POST', body: { tipo: nueva.tipo, anio, mes, fechaPago: nueva.fechaPago } }), () => 'Liquidación creada');
    if (r) navegar(`/sueldos/liquidaciones/${r.id}`);
  };
  const mesActual = hoy().slice(0, 7);
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Liquidaciones de sueldos</Title>
        {puede('sueldos.liquidar') && <Button size="xs" onClick={() => setNueva({ tipo: 'MENSUAL', mes: mesActual, fechaPago: finDeMes(mesActual) })}>Nueva liquidación</Button>}
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Período</Table.Th><Table.Th>Fecha de pago</Table.Th><Table.Th ta="right">Empleados</Table.Th><Table.Th ta="right">Neto total</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((l) => (
            <Table.Tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => navegar(`/sueldos/liquidaciones/${l.id}`)}>
              <Table.Td>{l.numero}</Table.Td><Table.Td>{periodoLiquidacion(l)}</Table.Td><Table.Td>{formatoFecha(l.fechaPago)}</Table.Td>
              <Table.Td ta="right">{l.empleados}</Table.Td><Table.Td ta="right">{formatoMoneda(l.totalNeto)}</Table.Td>
              <Table.Td><Badge color={l.estado === 'CERRADA' ? 'green' : 'yellow'} variant="light">{l.estado === 'CERRADA' ? 'Cerrada' : 'Borrador'}</Badge></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!nueva} onClose={() => setNueva(null)} title="Nueva liquidación">
        {nueva && (
          <Stack>
            <Select label="Tipo" data={[{ value: 'MENSUAL', label: 'Mensual' }, { value: 'SAC', label: 'SAC (aguinaldo)' }]} value={nueva.tipo} onChange={(v) => setNueva({ ...nueva, tipo: (v ?? 'MENSUAL') as 'MENSUAL' | 'SAC' })} />
            <TextInput type="month" label={nueva.tipo === 'SAC' ? 'Mes (junio o diciembre)' : 'Mes'} value={nueva.mes} onChange={(e) => setNueva({ ...nueva, mes: e.currentTarget.value, fechaPago: e.currentTarget.value ? finDeMes(e.currentTarget.value) : nueva.fechaPago })} />
            <TextInput type="date" label="Fecha de pago" value={nueva.fechaPago} onChange={(e) => setNueva({ ...nueva, fechaPago: e.currentTarget.value })} />
            {op.alerta}
            <Button onClick={crear} loading={op.enviando}>Crear y calcular</Button>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
