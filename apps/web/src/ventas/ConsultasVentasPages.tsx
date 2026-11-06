import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useAuth } from '../auth/AuthContext';
import { ESTADOS_VENTA, NOMBRE_TIPO, numeroVenta, TIPOS_VENTA, useClientes, useOperacionVentas, type ComprobanteVenta } from './comun';
import { EstadoEmision } from './EstadoEmision';

const estado = (e: string) => <Badge size="sm" variant="light" color={ESTADOS_VENTA[e]?.color ?? 'gray'}>{ESTADOS_VENTA[e]?.etiqueta ?? e}</Badge>;
const opcionesClientes = (cs: { id: string; razonSocial: string }[]) => cs.map((c) => ({ value: c.id, label: c.razonSocial }));

function DetalleComprobante({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const op = useOperacionVentas();
  const { puede } = useAuth();
  const q = useQuery({ queryKey: ['/ventas/comprobantes', id], queryFn: () => api<ComprobanteVenta>(`/ventas/comprobantes/${id}`) });
  const c = q.data;
  return (
    <Modal opened onClose={onCerrar} size="xl" title={c ? `${NOMBRE_TIPO[c.tipo]} ${c.letra} ${c.numero ? numeroVenta(c.puntoVenta, c.numero) : '(sin número)'}` : 'Comprobante'}>
      {c && (
        <Stack>
          <Text size="sm">{c.tercero?.razonSocial} · {formatoFecha(c.fecha)} · vence {formatoFecha(c.fechaVencimiento)} · {c.monedaCodigo}{c.monedaCodigo !== 'ARS' ? ` a ${c.cotizacion}` : ''}</Text>
          <Table withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Descripción</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Precio</Table.Th><Table.Th>IVA</Table.Th><Table.Th ta="right">Neto</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{c.renglones?.map((r) => (
              <Table.Tr key={r.id}><Table.Td>{r.descripcion}</Table.Td><Table.Td ta="right">{Number(r.cantidad)}</Table.Td><Table.Td ta="right">{formatoMoneda(r.precioUnitario, c.monedaCodigo)}</Table.Td><Table.Td>{r.alicuota}</Table.Td><Table.Td ta="right">{formatoMoneda(r.neto, c.monedaCodigo)}</Table.Td></Table.Tr>
            ))}</Table.Tbody>
          </Table>
          <Group justify="flex-end"><Text fw={700}>Total {formatoMoneda(c.total, c.monedaCodigo)}</Text>{c.saldo != null && <Text c="dimmed">Saldo {formatoMoneda(c.saldo, c.monedaCodigo)}</Text>}</Group>
          <EstadoEmision comprobante={c} enviando={op.enviando} onReintentar={() => void (puede('venta.emitir') && op.ejecutar(() => api(`/ventas/comprobantes/${id}/emitir`, { metodo: 'POST' }), () => 'Comprobante autorizado').then(() => q.refetch()))} />
          {op.error && <Alert color="red">{op.error}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

export function ComprobantesVentaPage() {
  const [params, setParams] = useSearchParams();
  const clientes = useClientes();
  const [f, setF] = useState<{ terceroId: string | null; desde: string; hasta: string; tipo: string | null; estado: string | null }>({ terceroId: null, desde: '', hasta: '', tipo: null, estado: null });
  const q = useQuery({ queryKey: ['/ventas/comprobantes', f], queryFn: () => api<{ items: ComprobanteVenta[]; total: number }>('/ventas/comprobantes', { query: { ...f, porPagina: 100 } }) });
  const id = params.get('id');
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Comprobantes de venta</Title>
      <Group align="flex-end" mb="md">
        <Select label="Cliente" w={260} searchable clearable data={opcionesClientes(clientes)} value={f.terceroId} onChange={(v) => setF({ ...f, terceroId: v })} />
        <TextInput label="Desde" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.currentTarget.value })} />
        <TextInput label="Hasta" type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.currentTarget.value })} />
        <Select label="Tipo" w={160} clearable data={TIPOS_VENTA} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} />
        <Select label="Estado" w={180} clearable data={Object.entries(ESTADOS_VENTA).map(([value, e]) => ({ value, label: e.etiqueta }))} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} />
      </Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Estado</Table.Th><Table.Th>CAE</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(q.data?.items ?? []).map((c) => (
          <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setParams({ id: c.id })}>
            <Table.Td>{formatoFecha(c.fecha)}</Table.Td><Table.Td>{`${NOMBRE_TIPO[c.tipo]} ${c.letra} ${c.numero ? numeroVenta(c.puntoVenta, c.numero) : ''}`}</Table.Td>
            <Table.Td>{c.tercero?.razonSocial}</Table.Td><Table.Td>{estado(c.estado)}</Table.Td><Table.Td>{c.cae ?? ''}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(c.total, c.monedaCodigo)}</Table.Td><Table.Td ta="right">{c.saldo != null ? formatoMoneda(c.saldo, c.monedaCodigo) : ''}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {id && <DetalleComprobante id={id} onCerrar={() => setParams({})} />}
    </Paper>
  );
}

interface Recibo { id: string; numero: number; puntoVenta: number; fecha: string; total: string; totalValores: string; totalRetenciones: string; estado: string; razonSocial?: string; tercero?: { razonSocial: string }; retenciones?: { tipo: string; jurisdiccion: string | null; numeroCertificado: string; importe: string }[] }

function DetalleRecibo({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const op = useOperacionVentas();
  const { puede } = useAuth();
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: ['/ventas/recibos', id], queryFn: () => api<Recibo>(`/ventas/recibos/${id}`) });
  const r = q.data;
  return (
    <Modal opened onClose={onCerrar} size="lg" title={r ? `Recibo ${numeroVenta(r.puntoVenta, r.numero)}` : 'Recibo'}>
      {r && (
        <Stack>
          <Text size="sm">{r.tercero?.razonSocial} · {formatoFecha(r.fecha)} · {r.estado === 'ANULADO' ? 'Anulado' : 'Confirmado'}</Text>
          <Text size="sm">Valores {formatoMoneda(r.totalValores)} · Retenciones {formatoMoneda(r.totalRetenciones)} · Total {formatoMoneda(r.total)}</Text>
          {r.retenciones?.map((x, i) => <Text key={i} size="xs" c="dimmed">{`Retención ${x.tipo}${x.jurisdiccion ? ` ${x.jurisdiccion}` : ''} cert. ${x.numeroCertificado}: ${formatoMoneda(x.importe)}`}</Text>)}
          {r.estado !== 'ANULADO' && puede('cobro.registrar') && (
            <Group align="flex-end">
              <TextInput label="Motivo de anulación" w={300} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
              <Button color="red" variant="light" disabled={!motivo.trim()} loading={op.enviando} onClick={() => void op.ejecutar(() => api(`/ventas/recibos/${id}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Recibo anulado').then(() => q.refetch())}>Anular recibo</Button>
            </Group>
          )}
          {op.error && <Alert color="red">{op.error}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

export function RecibosPage() {
  const [params, setParams] = useSearchParams();
  const clientes = useClientes();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['/ventas/recibos', terceroId], queryFn: () => api<{ items: Recibo[] }>('/ventas/recibos', { query: { terceroId, porPagina: 100 } }) });
  const id = params.get('id');
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Recibos</Title>
      <Select label="Cliente" w={300} mb="md" searchable clearable data={opcionesClientes(clientes)} value={terceroId} onChange={setTerceroId} />
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Recibo</Table.Th><Table.Th>Cliente</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(q.data?.items ?? []).map((r) => (
          <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setParams({ id: r.id })}>
            <Table.Td>{formatoFecha(r.fecha)}</Table.Td><Table.Td>{numeroVenta(r.puntoVenta, r.numero)}</Table.Td><Table.Td>{r.razonSocial}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(r.total)}</Table.Td><Table.Td>{r.estado === 'ANULADO' ? 'Anulado' : 'Confirmado'}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {id && <DetalleRecibo id={id} onCerrar={() => setParams({})} />}
    </Paper>
  );
}

interface CuentaCorriente {
  saldoAnterior: string; saldoFinal: string;
  movimientos: { id: string; fecha: string; comprobante: string; debe: string; haber: string; saldo: string }[];
  pendientes: { id: string; comprobante: string; vence: string; diasVencido: number; monedaCodigo: string; saldo: string }[];
}

export function CuentaCorrienteClientesPage() {
  const clientes = useClientes();
  const [terceroId, setTerceroId] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const q = useQuery({
    queryKey: ['/ventas/clientes/cuenta-corriente', terceroId, desde, hasta],
    queryFn: () => api<CuentaCorriente>(`/ventas/clientes/${terceroId}/cuenta-corriente`, { query: { desde, hasta } }),
    enabled: !!terceroId,
  });
  const cc = q.data;
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Cuenta corriente de clientes</Title>
        <Group align="flex-end">
          <Select label="Cliente" w={300} searchable data={opcionesClientes(clientes)} value={terceroId} onChange={setTerceroId} />
          <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
          <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        </Group>
        {cc && (
          <Table withTableBorder striped mt="md">
            <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th ta="right">Debe</Table.Th><Table.Th ta="right">Haber</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              <Table.Tr><Table.Td colSpan={4}>Saldo anterior</Table.Td><Table.Td ta="right">{formatoMoneda(cc.saldoAnterior)}</Table.Td></Table.Tr>
              {cc.movimientos.map((m) => (
                <Table.Tr key={m.id}><Table.Td>{formatoFecha(m.fecha)}</Table.Td><Table.Td>{m.comprobante}</Table.Td><Table.Td ta="right">{Number(m.debe) ? formatoMoneda(m.debe) : ''}</Table.Td><Table.Td ta="right">{Number(m.haber) ? formatoMoneda(m.haber) : ''}</Table.Td><Table.Td ta="right">{formatoMoneda(m.saldo)}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {cc && <Text fw={700} ta="right" mt="xs" data-testid="saldo-cliente">Saldo {formatoMoneda(cc.saldoFinal)}</Text>}
      </Paper>
      {cc && !!cc.pendientes.length && (
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="sm">Comprobantes pendientes</Title>
          <Table withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Comprobante</Table.Th><Table.Th>Vence</Table.Th><Table.Th ta="right">Días vencido</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{cc.pendientes.map((p) => (
              <Table.Tr key={p.id}><Table.Td>{p.comprobante}</Table.Td><Table.Td>{formatoFecha(p.vence)}</Table.Td><Table.Td ta="right">{p.diasVencido}</Table.Td><Table.Td ta="right">{formatoMoneda(p.saldo, p.monedaCodigo)}</Table.Td></Table.Tr>
            ))}</Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

export function SaldosClientesPage() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({
    queryKey: ['/ventas/saldos', fecha],
    queryFn: () => api<{ filas: { terceroId: string; razonSocial: string; saldo: string; noVencido: string; d1a30: string; d31a60: string; d61a90: string; mas90: string }[] }>('/ventas/saldos', { query: { fecha } }),
  });
  const columnas = [['noVencido', 'No vencido'], ['d1a30', '1 a 30'], ['d31a60', '31 a 60'], ['d61a90', '61 a 90'], ['mas90', 'Más de 90']] as const;
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Saldos de clientes</Title>
      <TextInput label="Al" type="date" w={180} mb="md" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Cliente</Table.Th>{columnas.map(([, t]) => <Table.Th key={t} ta="right">{t}</Table.Th>)}<Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(q.data?.filas ?? []).map((f) => (
          <Table.Tr key={f.terceroId}><Table.Td>{f.razonSocial}</Table.Td>{columnas.map(([k]) => <Table.Td key={k} ta="right">{formatoMoneda(f[k])}</Table.Td>)}<Table.Td ta="right" fw={700}>{formatoMoneda(f.saldo)}</Table.Td></Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Paper>
  );
}
