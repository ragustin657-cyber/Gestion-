import { ActionIcon, Alert, Button, Checkbox, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';
import { useClientes, usePuntosVenta } from './comun';
import type { PedidoVenta } from './PedidoVentaPage';

interface Directo { articuloId: string | null; descripcion: string; cantidad: string | number }

export function RemitoPage() {
  const qc = useQueryClient();
  const op = useOperacion();
  const clientes = useClientes();
  const puntos = usePuntosVenta();
  const depositos = (useQuery({ queryKey: ['/depositos', 'remito'], queryFn: () => api<{ id: string; nombre: string }[]>('/depositos') }).data ?? []).map((d) => ({ value: d.id, label: d.nombre }));
  const articulos = (useQuery({ queryKey: ['/articulos', 'remito'], queryFn: () => api<{ items: { id: string; codigo: string; descripcion: string }[] }>('/articulos', { query: { porPagina: 500 } }) }).data?.items ?? [])
    .map((a) => ({ value: a.id, label: `${a.codigo} ${a.descripcion}`, descripcion: a.descripcion }));
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [puntoVentaId, setPuntoVentaId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string | number>>({});
  const [directos, setDirectos] = useState<Directo[]>([]);
  const [hecho, setHecho] = useState<{ id: string; numeroTexto: string; advertencias: string[] } | null>(null);
  useEffect(() => { if (!puntoVentaId && puntos.length) setPuntoVentaId(puntos[0].id); }, [puntos, puntoVentaId]);
  const pedidos = useQuery({ queryKey: ['/ventas/pedidos', 'entregar', terceroId], queryFn: () => api<(PedidoVenta & { cliente: string })[]>('/ventas/pedidos', { query: { terceroId, pendientes: 'entregar' } }), enabled: !!terceroId }).data ?? [];
  const renglonesPedido = pedidos.flatMap((p) => p.renglones.filter((r) => Number(r.pendienteEntregar) > 0).map((r) => ({ ...r, pedido: p.numero })));
  const elegidos = Object.entries(cantidades).filter(([, c]) => Number(c) > 0);

  const confirmar = async () => {
    const r = await op.ejecutar(() => api<{ id: string; numeroTexto: string; advertencias: string[] }>('/ventas/remitos', {
      metodo: 'POST',
      body: {
        terceroId, puntoVentaId, fecha, depositoId,
        renglones: [...elegidos.map(([pedidoRenglonId, c]) => ({ pedidoRenglonId, cantidad: Number(c) })), ...directos.filter((d) => d.descripcion && Number(d.cantidad) > 0).map((d) => ({ articuloId: d.articuloId, descripcion: d.descripcion, cantidad: Number(d.cantidad) }))],
      },
    }), (x) => `Remito ${x.numeroTexto} registrado`);
    if (r) { setHecho(r); setCantidades({}); setDirectos([]); void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/ventas') || String(q.queryKey[0]).startsWith('/stock') }); }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Remito</Title>
      <Group align="flex-end" mb="md">
        <Select label="Cliente" w={300} searchable data={clientes.map((c) => ({ value: c.id, label: c.razonSocial }))} value={terceroId} onChange={(v) => { setTerceroId(v); setCantidades({}); }} />
        <Select label="Punto de venta" w={170} data={puntos.map((p) => ({ value: p.id, label: String(p.numero).padStart(4, '0') }))} value={puntoVentaId} onChange={setPuntoVentaId} />
        <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <Select label="Depósito" w={200} clearable placeholder="El del punto de venta" data={depositos} value={depositoId} onChange={setDepositoId} />
      </Group>
      {terceroId && (
        <>
          <Title order={5} mb="xs">Pendiente de entregar</Title>
          {renglonesPedido.length ? (
            <Table withTableBorder mb="md">
              <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Pedido</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Pendiente</Table.Th><Table.Th w={150}>A entregar</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {renglonesPedido.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Checkbox aria-label={`Entregar ${r.descripcion}`} checked={Number(cantidades[r.id] ?? 0) > 0} onChange={(e) => setCantidades({ ...cantidades, [r.id]: e.currentTarget.checked ? r.pendienteEntregar : 0 })} /></Table.Td>
                    <Table.Td>{r.pedido}</Table.Td>
                    <Table.Td>{r.descripcion}</Table.Td>
                    <Table.Td ta="right">{Number(r.pendienteEntregar).toLocaleString('es-AR')}</Table.Td>
                    <Table.Td><NumberInput size="xs" min={0} max={Number(r.pendienteEntregar)} decimalSeparator="," aria-label={`Cantidad ${r.descripcion}`} value={cantidades[r.id] ?? ''} onChange={(v) => setCantidades({ ...cantidades, [r.id]: v })} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text size="sm" c="dimmed" mb="md">El cliente no tiene pedidos pendientes de entrega.</Text>}
        </>
      )}
      <Title order={5} mb="xs">Renglones sin pedido</Title>
      {directos.map((d, i) => (
        <Group key={i} mb="xs" align="flex-end">
          <Select size="xs" w={260} searchable clearable placeholder="Texto libre" aria-label="Artículo" data={articulos} value={d.articuloId}
            onChange={(v) => setDirectos(directos.map((x, j) => (j === i ? { ...x, articuloId: v, descripcion: articulos.find((a) => a.value === v)?.descripcion ?? x.descripcion } : x)))} />
          <TextInput size="xs" w={260} aria-label="Descripción" value={d.descripcion} onChange={(e) => setDirectos(directos.map((x, j) => (j === i ? { ...x, descripcion: e.currentTarget.value } : x)))} />
          <NumberInput size="xs" w={110} min={0} decimalSeparator="," aria-label="Cantidad" value={d.cantidad} onChange={(v) => setDirectos(directos.map((x, j) => (j === i ? { ...x, cantidad: v } : x)))} />
          <ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => setDirectos(directos.filter((_, j) => j !== i))}><IconTrash size={14} /></ActionIcon>
        </Group>
      ))}
      <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setDirectos([...directos, { articuloId: null, descripcion: '', cantidad: 1 }])}>Agregar renglón</Button>
      {op.alerta}
      {hecho && <Group mt="sm"><Text>{`Remito ${hecho.numeroTexto}`}</Text><Button size="xs" variant="light" onClick={() => void descargar(`/ventas/remitos/${hecho.id}/pdf`, {}, `remito.pdf`)}>PDF</Button></Group>}
      {hecho?.advertencias.map((a) => <Alert key={a} color="yellow" mt="xs">{a}</Alert>)}
      <Group mt="md"><Button loading={op.enviando} disabled={!terceroId || !puntoVentaId || (!elegidos.length && !directos.length)} onClick={() => void confirmar()}>Confirmar remito</Button></Group>
    </Paper>
  );
}
