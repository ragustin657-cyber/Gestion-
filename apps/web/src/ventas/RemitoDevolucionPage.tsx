import { Alert, Button, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { useClientes, usePuntosVenta } from './comun';

/** Remito de devolución (E54): desde renglones de remitos de entrega del cliente. */

export interface Devolvible { remitoRenglonId: string; numero: string; descripcion: string; entregado: string; devuelto: string; quedan: string }

export function TablaDevolvibles({ filas, cantidades, onChange }: { filas: Devolvible[]; cantidades: Record<string, string | number>; onChange: (c: Record<string, string | number>) => void }) {
  if (!filas.length) return <Text size="sm" c="dimmed">El cliente no tiene remitos de entrega con mercadería para devolver.</Text>;
  return (
    <Table withTableBorder>
      <Table.Thead><Table.Tr><Table.Th>Remito</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Entregado</Table.Th><Table.Th ta="right">Devuelto</Table.Th><Table.Th ta="right">Quedan</Table.Th><Table.Th w={150}>A devolver</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f) => (
          <Table.Tr key={f.remitoRenglonId}>
            <Table.Td>{f.numero}</Table.Td>
            <Table.Td>{f.descripcion}</Table.Td>
            <Table.Td ta="right">{Number(f.entregado).toLocaleString('es-AR')}</Table.Td>
            <Table.Td ta="right">{Number(f.devuelto).toLocaleString('es-AR')}</Table.Td>
            <Table.Td ta="right">{Number(f.quedan).toLocaleString('es-AR')}</Table.Td>
            <Table.Td><NumberInput size="xs" min={0} max={Number(f.quedan)} decimalSeparator="," aria-label={`Devolver ${f.descripcion}`} value={cantidades[f.remitoRenglonId] ?? ''} onChange={(v) => onChange({ ...cantidades, [f.remitoRenglonId]: v })} /></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function RemitoDevolucionPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const clientes = useClientes();
  const puntos = usePuntosVenta();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [puntoVentaId, setPuntoVentaId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string | number>>({});
  const [hecho, setHecho] = useState<{ id: string; numeroTexto: string } | null>(null);
  useEffect(() => { if (!puntoVentaId && puntos.length) setPuntoVentaId(puntos[0].id); }, [puntos, puntoVentaId]);
  const devolvibles = useQuery({ queryKey: ['/ventas/remitos/devolvibles', terceroId], queryFn: () => api<Devolvible[]>('/ventas/remitos/devolvibles', { query: { terceroId } }), enabled: !!terceroId }).data ?? [];
  const elegidos = Object.entries(cantidades).filter(([, c]) => Number(c) > 0);
  const confirmar = async () => {
    const r = await op.ejecutar(() => api<{ id: string; numeroTexto: string }>('/ventas/remitos/devoluciones', {
      metodo: 'POST', body: { terceroId, puntoVentaId, fecha, observaciones: observaciones || null, renglones: elegidos.map(([remitoRenglonOrigenId, c]) => ({ remitoRenglonOrigenId, cantidad: Number(c) })) },
    }), (x) => `Remito de devolución ${x.numeroTexto} registrado`);
    if (r) { setHecho(r); setCantidades({}); void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/ventas') || String(q.queryKey[0]).startsWith('/stock') }); }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Remito de devolución</Title>
      <Group align="flex-end" mb="md">
        <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={(v) => { setTerceroId(v); setCantidades({}); setHecho(null); }} />
        <Select label="Punto de venta" w={170} data={puntos.map((p) => ({ value: p.id, label: String(p.numero).padStart(4, '0') }))} value={puntoVentaId} onChange={setPuntoVentaId} />
        <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <TextInput label="Observaciones" w={300} value={observaciones} onChange={(e) => setObservaciones(e.currentTarget.value)} />
      </Group>
      {terceroId && <TablaDevolvibles filas={devolvibles} cantidades={cantidades} onChange={setCantidades} />}
      {op.alerta}
      {hecho && <Alert color="green" mt="sm">Remito de devolución {hecho.numeroTexto} registrado. <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/ventas/remitos/${hecho.id}/pdf`, {}, 'remito-devolucion.pdf')}>PDF</Button></Alert>}
      <Group justify="flex-end" mt="md">
        <Button loading={op.enviando} disabled={!terceroId || !puntoVentaId || !elegidos.length} onClick={() => void confirmar()}>Confirmar devolución</Button>
      </Group>
    </Paper>
  );
}
