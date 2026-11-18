import { Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { useOperacionVentas } from './comun';

export interface GrupoIntereses {
  terceroId: string; cliente: string; monedaCodigo: string; total: string;
  renglones: { comprobanteId: string; comprobante: string; vencimiento: string; saldo: string; dias: number; interes: string; alicuota: string }[];
}
interface NotaResultado { id: string; monedaCodigo: string; total: string; estado: string; mensaje?: string }
interface Liquidacion { id: string; numero: number; anio: number; mes: number; tasa: string; totales: Record<string, string>; notas: { id: string; cliente: string; monedaCodigo: string; total: string; estado: string; numero: string | null }[] }

const ESTADOS: Record<string, { texto: string; color: string }> = {
  AUTORIZADO: { texto: 'Autorizada', color: 'green' }, PENDIENTE_CAE: { texto: 'Pendiente de CAE', color: 'yellow' }, RECHAZADO: { texto: 'Rechazada', color: 'red' }, ELIMINADA: { texto: 'Eliminada', color: 'gray' },
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Intereses del mes por cliente y factura, con casillas para dejar afuera lo que no se cobra. */
export function TablaIntereses({ grupos, excluidos, onCambiar }: { grupos: GrupoIntereses[]; excluidos: string[]; onCambiar: (excluidos: string[]) => void }) {
  const totales: Record<string, number> = {};
  for (const g of grupos) for (const r of g.renglones) if (!excluidos.includes(r.comprobanteId)) totales[g.monedaCodigo] = (totales[g.monedaCodigo] ?? 0) + Number(r.interes);
  const total = Object.keys(totales).length ? Object.entries(totales).map(([m, t]) => formatoMoneda(t, m)).join(' + ') : formatoMoneda(0);
  const alternar = (ids: string[], incluir: boolean) => onCambiar(incluir ? excluidos.filter((x) => !ids.includes(x)) : [...new Set([...excluidos, ...ids])]);
  return (
    <Stack>
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Comprobante</Table.Th><Table.Th>Vencimiento</Table.Th><Table.Th ta="right">Saldo al cierre</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th ta="right">IVA</Table.Th><Table.Th ta="right">Interés</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {grupos.map((g) => {
            const ids = g.renglones.map((r) => r.comprobanteId);
            const elegidos = ids.filter((id) => !excluidos.includes(id));
            return (
              <Fragment key={`${g.terceroId}-${g.monedaCodigo}`}>
                <Table.Tr bg="var(--mantine-color-gray-0)">
                  <Table.Td><Checkbox aria-label={`Cliente ${g.cliente}`} checked={elegidos.length === ids.length} indeterminate={elegidos.length > 0 && elegidos.length < ids.length} onChange={() => alternar(ids, elegidos.length < ids.length)} /></Table.Td>
                  <Table.Td colSpan={5}><Text fw={600}>{g.cliente}{g.monedaCodigo !== 'ARS' ? ` (${g.monedaCodigo})` : ''}</Text></Table.Td>
                  <Table.Td ta="right"><Text fw={600}>{formatoMoneda(g.renglones.filter((r) => !excluidos.includes(r.comprobanteId)).reduce((s, r) => s + Number(r.interes), 0), g.monedaCodigo)}</Text></Table.Td>
                </Table.Tr>
                {g.renglones.map((r) => (
                  <Table.Tr key={r.comprobanteId}>
                    <Table.Td><Checkbox aria-label={`Factura ${r.comprobante}`} checked={!excluidos.includes(r.comprobanteId)} onChange={(e) => alternar([r.comprobanteId], e.currentTarget.checked)} /></Table.Td>
                    <Table.Td>{r.comprobante}</Table.Td><Table.Td>{formatoFecha(r.vencimiento)}</Table.Td>
                    <Table.Td ta="right">{formatoMoneda(r.saldo, g.monedaCodigo)}</Table.Td><Table.Td ta="right">{r.dias}</Table.Td>
                    <Table.Td ta="right">{r.alicuota === 'EXENTO' ? 'Exento' : `${r.alicuota.replace('.', ',')} %`}</Table.Td>
                    <Table.Td ta="right">{formatoMoneda(r.interes, g.monedaCodigo)}</Table.Td>
                  </Table.Tr>
                ))}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
      <Text fw={700} ta="right" data-testid="total-intereses">{`Total a facturar ${total}`}</Text>
    </Stack>
  );
}

/** Tasa mensual y descripción del renglón. */
export function ConfigIntereses() {
  const op = useOperacionVentas();
  const q = useQuery({ queryKey: ['/ventas/intereses/configuracion'], queryFn: () => api<{ tasaMensual: string | null; descripcion: string }>('/ventas/intereses/configuracion') });
  const [tasa, setTasa] = useState<number | string>('');
  const [descripcion, setDescripcion] = useState('Intereses por mora');
  useEffect(() => { if (q.data) { setTasa(q.data.tasaMensual ? Number(q.data.tasaMensual) : ''); setDescripcion(q.data.descripcion); } }, [q.data]);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={4} mb="sm">Configuración</Title>
      {q.data && !q.data.tasaMensual && <Alert color="yellow" mb="sm">Cargue la tasa mensual para poder liquidar intereses.</Alert>}
      <Group align="flex-end">
        <NumberInput label="Tasa mensual (%)" min={0} max={100} decimalScale={2} decimalSeparator="," value={tasa} onChange={setTasa} w={160} />
        <TextInput label="Descripción del renglón" value={descripcion} onChange={(e) => setDescripcion(e.currentTarget.value)} w={260} />
        <Button variant="light" loading={op.enviando} disabled={tasa === ''} onClick={() => void op.ejecutar(() => api('/ventas/intereses/configuracion', { metodo: 'PUT', body: { tasaMensual: Number(tasa), descripcion } }), () => 'Configuración guardada')}>Guardar</Button>
      </Group>
      {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
    </Paper>
  );
}

export function InteresesPage() {
  const op = useOperacionVentas();
  const anterior = (() => { const [a, m] = hoy().split('-').map(Number); return m === 1 ? { anio: a - 1, mes: 12 } : { anio: a, mes: m - 1 }; })();
  const [anio, setAnio] = useState(anterior.anio);
  const [mes, setMes] = useState(anterior.mes);
  const [excluidos, setExcluidos] = useState<string[]>([]);
  const [resultado, setResultado] = useState<NotaResultado[] | null>(null);
  const q = useQuery({ queryKey: ['/ventas/intereses', anio, mes], queryFn: () => api<{ tasa: string; grupos: GrupoIntereses[] }>('/ventas/intereses', { query: { anio, mes } }), retry: false });
  const historial = useQuery({ queryKey: ['/ventas/intereses/liquidaciones'], queryFn: () => api<Liquidacion[]>('/ventas/intereses/liquidaciones') });
  const grupos = q.data?.grupos ?? [];
  const quedan = grupos.some((g) => g.renglones.some((r) => !excluidos.includes(r.comprobanteId)));
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={3}>Intereses por mora</Title>
          <Group>
            <Select aria-label="Mes" w={140} data={MESES.map((m, i) => ({ value: String(i + 1), label: m }))} value={String(mes)} onChange={(v) => { setMes(Number(v) || mes); setExcluidos([]); setResultado(null); }} allowDeselect={false} />
            <NumberInput aria-label="Año" w={100} value={anio} onChange={(v) => { setAnio(Number(v) || anio); setExcluidos([]); setResultado(null); }} />
          </Group>
        </Group>
        {q.error && <Alert color="yellow" mb="sm">{q.error instanceof Error ? q.error.message : 'No se pudo calcular'}</Alert>}
        {q.data && <Text size="sm" c="dimmed" mb="sm">{`Tasa ${q.data.tasa.replace('.', ',')} % mensual`}</Text>}
        {q.data && !grupos.length && <Text c="dimmed">No hay intereses para liquidar en este mes.</Text>}
        {!!grupos.length && <TablaIntereses grupos={grupos} excluidos={excluidos} onCambiar={setExcluidos} />}
        {op.error && <Alert color="red" mt="sm">{op.error}</Alert>}
        {resultado && (
          <Stack gap={4} mt="sm">
            {resultado.map((n) => <Text key={n.id} size="sm">{`Nota de débito ${formatoMoneda(n.total, n.monedaCodigo)}: ${ESTADOS[n.estado]?.texto ?? n.estado}${n.mensaje ? ` — ${n.mensaje}` : ''}`}</Text>)}
          </Stack>
        )}
        {!!grupos.length && (
          <Group justify="flex-end" mt="sm">
            <Button disabled={!quedan} loading={op.enviando} onClick={async () => {
              const r = await op.ejecutar(() => api<{ numero: number; notas: NotaResultado[] }>('/ventas/intereses', { metodo: 'POST', body: { anio, mes, excluir: excluidos } }), (x) => `Liquidación de intereses N° ${x.numero} confirmada`);
              if (r) { setResultado(r.notas); setExcluidos([]); }
            }}>Confirmar liquidación</Button>
          </Group>
        )}
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Liquidaciones</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Mes</Table.Th><Table.Th ta="right">Tasa</Table.Th><Table.Th>Total</Table.Th><Table.Th>Notas de débito</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(historial.data ?? []).map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>{l.numero}</Table.Td><Table.Td>{`${String(l.mes).padStart(2, '0')}/${l.anio}`}</Table.Td><Table.Td ta="right">{`${l.tasa.replace('.', ',')} %`}</Table.Td>
                <Table.Td>{Object.entries(l.totales).map(([m, t]) => formatoMoneda(t, m)).join(' + ')}</Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    {l.notas.map((n) => <Group key={n.id} gap={4}><Text size="sm">{`${n.cliente}${n.numero ? ` · ${n.numero}` : ''}`}</Text><Badge size="xs" variant="light" color={ESTADOS[n.estado]?.color}>{ESTADOS[n.estado]?.texto ?? n.estado}</Badge></Group>)}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <ConfigIntereses />
    </Stack>
  );
}
