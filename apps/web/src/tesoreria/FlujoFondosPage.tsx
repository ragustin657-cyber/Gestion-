import { CompositeChart } from '@mantine/charts';
import { Alert, Button, Checkbox, Group, Modal, Paper, SegmentedControl, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta } from './comun';

type Ingresos = { cheques: string; transferencias: string; cobranzas: string; vencidoACobrar: string };
type Egresos = { chequesPropios: string; ordenesPago: string; proveedores: string; vencidoAPagar: string };
export interface FilaFlujo { desde: string; hasta: string; etiqueta: string; ingresos: Ingresos; egresos: Egresos; totalIngresos: string; totalEgresos: string; saldo: string }
export interface Flujo { desde: string; hasta: string; agrupar: string; incluirVencidos: boolean; saldoInicial: string; filas: FilaFlujo[]; primerNegativo: string | null }
interface ItemDetalle { concepto: string; fecha: string; descripcion: string; tercero: string; importe: string }
type Periodo = { desde: string; hasta: string; etiqueta: string };

const COL_ING: [keyof Ingresos, string][] = [['cheques', 'Cheques'], ['transferencias', 'Transferencias'], ['cobranzas', 'Cobranzas'], ['vencidoACobrar', 'Vencido a cobrar']];
const COL_EGR: [keyof Egresos, string][] = [['chequesPropios', 'Cheques propios'], ['ordenesPago', 'OP aprobadas'], ['proveedores', 'Proveedores'], ['vencidoAPagar', 'Vencido a pagar']];
const NOMBRES: Record<string, string> = Object.fromEntries([...COL_ING, ...COL_EGR].map(([k, v]) => [k, v]));

/** Datos del gráfico: ingresos y egresos por período con el saldo. */
export const serieFlujo = (filas: FilaFlujo[]) => filas.map((f) => ({ periodo: f.etiqueta, ingresos: Number(f.totalIngresos), egresos: Number(f.totalEgresos), saldo: Number(f.saldo) }));

export function TablaFlujo({ datos, onPeriodo }: { datos: Flujo; onPeriodo: (p: Periodo) => void }) {
  const celda = (v: string) => (Number(v) ? formatoMoneda(v) : '—');
  return <>
    {datos.primerNegativo && <Alert color="red" mb="sm">{`El saldo queda negativo en ${datos.primerNegativo}`}</Alert>}
    <Table.ScrollContainer minWidth={1100}>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead>
          <Table.Tr><Table.Th>Período</Table.Th>{COL_ING.map(([k, t]) => <Table.Th key={k} ta="right" c="teal">{t}</Table.Th>)}{COL_EGR.map(([k, t]) => <Table.Th key={k} ta="right" c="red">{t}</Table.Th>)}<Table.Th ta="right">Saldo</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr><Table.Td fw={600}>Saldo inicial</Table.Td>{[...COL_ING, ...COL_EGR].map(([k]) => <Table.Td key={k} />)}<Table.Td ta="right" fw={600}>{formatoMoneda(datos.saldoInicial)}</Table.Td></Table.Tr>
          {datos.filas.map((f) => (
            <Table.Tr key={f.desde} style={{ cursor: 'pointer' }} onClick={() => onPeriodo({ desde: f.desde, hasta: f.hasta, etiqueta: f.etiqueta })}>
              <Table.Td>{f.etiqueta}</Table.Td>
              {COL_ING.map(([k]) => <Table.Td key={k} ta="right" c={k === 'vencidoACobrar' && !datos.incluirVencidos ? 'dimmed' : undefined}>{celda(f.ingresos[k])}</Table.Td>)}
              {COL_EGR.map(([k]) => <Table.Td key={k} ta="right" c={k === 'vencidoAPagar' && !datos.incluirVencidos ? 'dimmed' : undefined}>{celda(f.egresos[k])}</Table.Td>)}
              <Table.Td ta="right" fw={600} c={Number(f.saldo) < 0 ? 'red' : undefined} data-negativo={Number(f.saldo) < 0 ? 'true' : 'false'}>{formatoMoneda(f.saldo)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  </>;
}

const enSemanas = (n: number) => { const d = new Date(`${hoy()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n * 7); return d.toISOString().slice(0, 10); };

export function FlujoFondosPage() {
  const [agrupar, setAgrupar] = useState('semana');
  const [hasta, setHasta] = useState(enSemanas(8));
  const [incluirVencidos, setIncluirVencidos] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const query = { hasta, agrupar, incluirVencidos: String(incluirVencidos) };
  const q = useQuery({ queryKey: ['/tesoreria/flujo', query], queryFn: () => api<Flujo>('/tesoreria/flujo', { query }), enabled: !!hasta });
  const detalle = useQuery({
    queryKey: ['/tesoreria/flujo/detalle', periodo, incluirVencidos],
    queryFn: () => api<ItemDetalle[]>('/tesoreria/flujo/detalle', { query: { desde: periodo!.desde, hasta: periodo!.hasta, incluirVencidos: String(incluirVencidos) } }), enabled: !!periodo,
  });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Flujo de fondos proyectado</Title>
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/tesoreria/flujo', { ...query, formato: 'xlsx' }, `flujo-${hoy()}.xlsx`)}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/tesoreria/flujo', { ...query, formato: 'pdf' }, `flujo-${hoy()}.pdf`)}>PDF</Button>
        </Group>
      </Group>
      <Group align="flex-end" mb="xs">
        <SegmentedControl data={[{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }]} value={agrupar}
          onChange={(v) => { setAgrupar(v); setHasta(v === 'dia' ? enSemanas(4) : v === 'mes' ? enSemanas(26) : enSemanas(8)); }} />
        <TextInput label="Hasta" type="date" w={170} value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <Checkbox label="Incluir vencidos" checked={incluirVencidos} onChange={(e) => setIncluirVencidos(e.currentTarget.checked)} mb={8} />
      </Group>
      <Text size="xs" c="dimmed" mb="md">En pesos (dólares a la cotización del día). Saldo de bancos y cajas, cheques en cartera y en tránsito, transferencias a acreditar y cobranzas por vencimiento, menos cheques propios diferidos, OP aprobadas y facturas de proveedores por vencimiento. Lo vencido va al primer período.</Text>
      {errorConsulta(q.error)}
      {q.data && <>
        <CompositeChart h={240} mb="md" dataKey="periodo" data={serieFlujo(q.data.filas)} valueFormatter={(v) => formatoMoneda(v)} withLegend
          series={[{ name: 'ingresos', label: 'Ingresos', color: 'teal.5', type: 'bar' }, { name: 'egresos', label: 'Egresos', color: 'red.5', type: 'bar' }, { name: 'saldo', label: 'Saldo', color: 'indigo.6', type: 'line' }]} />
        <TablaFlujo datos={q.data} onPeriodo={setPeriodo} />
      </>}
      <Modal opened={!!periodo} onClose={() => setPeriodo(null)} title={`Detalle ${periodo?.etiqueta ?? ''}`} size="xl">
        {errorConsulta(detalle.error)}
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Concepto</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Comprobante / valor</Table.Th><Table.Th>Tercero</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(detalle.data ?? []).map((d, i) => <Table.Tr key={i}><Table.Td>{NOMBRES[d.concepto] ?? d.concepto}</Table.Td><Table.Td>{formatoFecha(d.fecha)}</Table.Td><Table.Td>{d.descripcion}</Table.Td><Table.Td>{d.tercero}</Table.Td><Table.Td ta="right">{formatoMoneda(d.importe)}</Table.Td></Table.Tr>)}
            {detalle.data && !detalle.data.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">Sin movimientos en el período</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Modal>
    </Paper>
  );
}
