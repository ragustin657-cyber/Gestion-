import { Badge, Button, Checkbox, Group, Modal, Paper, Select, Table, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, descargar } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { ESTADOS_PEDIDO, type PedidoVenta } from './PedidoVentaPage';

export interface Pendiente { id: string; origen: 'REMITO' | 'PEDIDO'; numero: string; descripcion: string; pendiente: string }

/** Remitos y pedidos pendientes de facturar, con cantidad elegible por renglón. */
export function TablaPendientes({ pendientes, seleccion, onChange }: { pendientes: Pendiente[]; seleccion: Record<string, string>; onChange: (s: Record<string, string>) => void }) {
  return (
    <Table withTableBorder>
      <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Documento</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Pendiente</Table.Th><Table.Th w={130}>A facturar</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {pendientes.map((p) => (
          <Table.Tr key={p.id}>
            <Table.Td><Checkbox aria-label={`Elegir ${p.numero}`} checked={p.id in seleccion} onChange={(e) => {
              const s = { ...seleccion };
              if (e.currentTarget.checked) s[p.id] = p.pendiente; else delete s[p.id];
              onChange(s);
            }} /></Table.Td>
            <Table.Td>{p.numero}</Table.Td>
            <Table.Td>{p.descripcion}</Table.Td>
            <Table.Td ta="right">{p.pendiente}</Table.Td>
            <Table.Td>{p.id in seleccion && <TextInput size="xs" aria-label={`Cantidad ${p.numero}`} value={seleccion[p.id]} onChange={(e) => onChange({ ...seleccion, [p.id]: e.currentTarget.value })} />}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function PedidosPage() {
  const [estado, setEstado] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['/ventas/pedidos', estado, pendientes], queryFn: () => api<(PedidoVenta & { cliente: string })[]>('/ventas/pedidos', { query: { estado, pendientes } }) });
  const suma = (p: PedidoVenta, campo: 'pendienteEntregar' | 'pendienteFacturar') => p.renglones.reduce((s, r) => s + Number(r[campo]), 0);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Pedidos</Title>
      <Group mb="md">
        <Select label="Estado" w={220} clearable data={Object.entries(ESTADOS_PEDIDO).map(([value, e]) => ({ value, label: e.etiqueta }))} value={estado} onChange={setEstado} />
        <Select label="Pendientes" w={200} clearable data={[{ value: 'entregar', label: 'De entregar' }, { value: 'facturar', label: 'De facturar' }]} value={pendientes} onChange={setPendientes} />
      </Group>
      {errorConsulta(q.error)}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Estado</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Pend. entregar</Table.Th><Table.Th ta="right">Pend. facturar</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.numero}</Table.Td>
              <Table.Td>{formatoFecha(p.fecha)}</Table.Td>
              <Table.Td>{p.cliente}</Table.Td>
              <Table.Td><Badge variant="light" color={ESTADOS_PEDIDO[p.estado]?.color}>{ESTADOS_PEDIDO[p.estado]?.etiqueta}</Badge></Table.Td>
              <Table.Td ta="right">{formatoMoneda(p.total, p.monedaCodigo)}</Table.Td>
              <Table.Td ta="right">{suma(p, 'pendienteEntregar').toLocaleString('es-AR')}</Table.Td>
              <Table.Td ta="right">{suma(p, 'pendienteFacturar').toLocaleString('es-AR')}</Table.Td>
              <Table.Td><Group gap={4} wrap="nowrap">
                <Button size="compact-xs" variant="light" component={Link} to={`/ventas/pedido?id=${p.id}`}>Abrir</Button>
                <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/ventas/pedidos/${p.id}/pdf`, {}, `pedido-${p.numero}.pdf`)}>PDF</Button>
              </Group></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

interface RemitoFila { id: string; numeroTexto: string; fecha: string; cliente: string; estado: string; pendienteFacturar: string }

export function RemitosPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const [pendientes, setPendientes] = useState(false);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: ['/ventas/remitos', pendientes], queryFn: () => api<RemitoFila[]>('/ventas/remitos', { query: { pendientes: pendientes ? 'facturar' : undefined } }) });
  const anular = async () => {
    const r = await op.ejecutar(() => api(`/ventas/remitos/${anulando}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Remito anulado');
    setAnulando(null); setMotivo('');
    if (r) void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/ventas') });
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Remitos</Title>
      <Checkbox label="Solo pendientes de facturar" mb="md" checked={pendientes} onChange={(e) => setPendientes(e.currentTarget.checked)} />
      {errorConsulta(q.error)}
      {op.alerta}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Número</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Cliente</Table.Th><Table.Th ta="right">Pend. facturar</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.numeroTexto}</Table.Td>
              <Table.Td>{formatoFecha(r.fecha)}</Table.Td>
              <Table.Td>{r.cliente}</Table.Td>
              <Table.Td ta="right">{r.estado === 'ANULADO' ? <Badge color="gray" variant="light">Anulado</Badge> : Number(r.pendienteFacturar).toLocaleString('es-AR')}</Table.Td>
              <Table.Td><Group gap={4} wrap="nowrap">
                <Button size="compact-xs" variant="subtle" onClick={() => void descargar(`/ventas/remitos/${r.id}/pdf`, {}, `remito.pdf`)}>PDF</Button>
                {r.estado !== 'ANULADO' && puede('pedido.gestionar') && <Button size="compact-xs" color="red" variant="light" onClick={() => setAnulando(r.id)}>Anular</Button>}
              </Group></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title="Anular remito">
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group mt="md"><Button color="red" disabled={!motivo.trim()} onClick={() => void anular()}>Anular</Button></Group>
      </Modal>
    </Paper>
  );
}
