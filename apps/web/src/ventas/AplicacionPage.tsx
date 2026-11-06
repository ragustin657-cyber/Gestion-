import { Alert, Button, Group, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { numero, useClientes, useOperacionVentas, type MovPendiente } from './comun';

interface Aplicacion { id: string; numero: number; fecha: string; importe: string; diferenciaCambio: string; anulada: boolean; credito: string; debito: string }

/** Detalle de una aplicación con su botón Deshacer (a donde lleva el Diario). */
function DetalleAplicacion({ id }: { id: string }) {
  const op = useOperacionVentas();
  const q = useQuery({ queryKey: ['/ventas/aplicaciones', id], queryFn: () => api<Aplicacion[]>(`/ventas/aplicaciones/${id}`) });
  const aps = q.data ?? [];
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={4} mb="sm">Aplicación {aps[0]?.numero ?? ''}</Title>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Crédito</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Dif. de cambio</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{aps.map((a, i) => (
          <Table.Tr key={i}><Table.Td>{formatoFecha(a.fecha)}</Table.Td><Table.Td>{a.credito}</Table.Td><Table.Td>{a.debito}</Table.Td><Table.Td ta="right">{a.importe}</Table.Td><Table.Td ta="right">{formatoMoneda(a.diferenciaCambio)}</Table.Td></Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {aps.length > 0 && !aps[0].anulada && (
        <Group justify="flex-end" mt="sm"><Button color="red" variant="light" loading={op.enviando} onClick={() => void op.ejecutar(() => api(`/ventas/aplicaciones/${id}/anular`, { metodo: 'POST' }), () => 'Aplicación deshecha')}>Deshacer</Button></Group>
      )}
      {aps[0]?.anulada && <Alert color="gray" mt="sm">Aplicación deshecha</Alert>}
      {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
    </Paper>
  );
}

export function AplicacionPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const clientes = useClientes();
  const op = useOperacionVentas();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [creditoId, setCreditoId] = useState<string | null>(null);
  const [importes, setImportes] = useState<Record<string, string>>({});
  const [hecha, setHecha] = useState<string | null>(null);
  const pend = useQuery({
    queryKey: ['/ventas/clientes/pendientes', terceroId],
    queryFn: () => api<{ creditos: MovPendiente[]; debitos: MovPendiente[] }>(`/ventas/clientes/${terceroId}/pendientes`),
    enabled: !!terceroId,
  }).data;
  if (id) return <DetalleAplicacion id={id} />;
  const credito = pend?.creditos.find((c) => c.id === creditoId);

  async function aplicar() {
    const items = Object.entries(importes).filter(([, v]) => numero(v) > 0).map(([debitoMovId, v]) => ({ creditoMovId: creditoId, debitoMovId, importe: numero(v) }));
    const r = await op.ejecutar(() => api<{ id: string; numero: number; diferenciaCambio: string }>('/ventas/aplicaciones', { metodo: 'POST', body: { terceroId, fecha, items } }),
      (x) => `Aplicación ${x.numero} registrada${Number(x.diferenciaCambio) ? ` (diferencia de cambio ${formatoMoneda(x.diferenciaCambio)})` : ''}`);
    if (r) { setImportes({}); setCreditoId(null); setHecha(r.id); }
  }

  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Aplicación de cobros</Title>
        <Group align="flex-end">
          <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={(v) => { setTerceroId(v); setCreditoId(null); setImportes({}); }} />
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Saldo a favor" w={380} data={(pend?.creditos ?? []).map((c) => ({ value: c.id, label: `${c.descripcion} · ${formatoMoneda(Math.abs(Number(c.saldo)), c.monedaCodigo)}` }))} value={creditoId} onChange={setCreditoId} />
        </Group>
        <Table withTableBorder mt="md">
          <Table.Thead><Table.Tr><Table.Th>Comprobante</Table.Th><Table.Th>Vence</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th w={160}>Aplicar</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(pend?.debitos ?? []).map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>{d.descripcion}</Table.Td><Table.Td>{formatoFecha(d.fechaVencimiento)}</Table.Td><Table.Td ta="right">{formatoMoneda(d.saldo, d.monedaCodigo)}</Table.Td>
                <Table.Td><TextInput size="xs" aria-label={`Aplicar a ${d.descripcion}`} inputMode="decimal" value={importes[d.id] ?? ''} onChange={(e) => setImportes({ ...importes, [d.id]: e.currentTarget.value })} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {credito && <Text size="sm" mt="xs" c="dimmed">Los importes se expresan en la moneda de cada comprobante. Un comprobante en dólares cancelado con pesos usa la cotización del día y registra la diferencia de cambio.</Text>}
        <Group justify="flex-end" mt="md"><Button loading={op.enviando} disabled={!creditoId || !Object.values(importes).some((v) => numero(v) > 0)} onClick={() => void aplicar()}>Aplicar</Button></Group>
        {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
      </Paper>
      {hecha && <DetalleAplicacion id={hecha} />}
    </Stack>
  );
}
