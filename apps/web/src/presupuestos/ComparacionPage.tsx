import { BarChart } from '@mantine/charts';
import { Badge, Button, Group, Paper, SegmentedControl, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { useCentrosCosto } from '../contabilidad/comun';
import { errorConsulta } from '../tesoreria/comun';
import { Comparacion, mmaaaa, pctTexto, PresupuestoLista } from './comun';

export function TablaComparacion({ datos }: { datos: Comparacion }) {
  const color = (fav: boolean, desvio: string) => (Number(desvio) === 0 ? undefined : fav ? 'teal' : 'red');
  const total = (n: string, t: Comparacion['totales']['ingresos'], testid?: string, fuerte = false) => (
    <Table.Tr data-testid={testid}>
      <Table.Th>{n}</Table.Th><Table.Th ta="right">{formatoMoneda(t.presupuesto)}</Table.Th><Table.Th ta="right">{formatoMoneda(t.real)}</Table.Th>
      <Table.Th ta="right" fw={fuerte ? 700 : undefined}>{formatoMoneda(t.desvio)}</Table.Th><Table.Th ta="right">{pctTexto(t.desvioPct)}</Table.Th>
    </Table.Tr>
  );
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Concepto</Table.Th><Table.Th ta="right">Presupuesto</Table.Th><Table.Th ta="right">Real</Table.Th><Table.Th ta="right">Desvío</Table.Th><Table.Th ta="right">Desvío %</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {datos.filas.map((f) => (
          <Table.Tr key={f.clave}>
            <Table.Td>{f.nombre} {f.sinPresupuesto && <Badge size="xs" variant="light" color="orange">Sin presupuestar</Badge>}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(f.presupuesto)}</Table.Td>
            <Table.Td ta="right">{formatoMoneda(f.real)}</Table.Td>
            <Table.Td ta="right" c={color(f.favorable, f.desvio)} data-favorable={String(f.favorable)}>{formatoMoneda(f.desvio)}</Table.Td>
            <Table.Td ta="right" c={color(f.favorable, f.desvio)}>{pctTexto(f.desvioPct)}</Table.Td>
          </Table.Tr>
        ))}
        {!datos.filas.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">Sin datos en el período</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
      <Table.Tfoot>
        {total('Ingresos', datos.totales.ingresos)}
        {total('Egresos', datos.totales.egresos)}
        {total('Resultado', datos.totales.resultado, 'total-resultado', true)}
      </Table.Tfoot>
    </Table>
  );
}

export function ComparacionPage() {
  const lista = useQuery({ queryKey: ['/presupuestos'], queryFn: () => api<PresupuestoLista[]>('/presupuestos') });
  const [id, setId] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [agrupar, setAgrupar] = useState('cuenta');
  const [centro, setCentro] = useState<string | null>(null);
  const centros = useCentrosCosto();
  useEffect(() => {
    if (!id && lista.data?.length) setId((lista.data.find((p) => p.vigente) ?? lista.data[lista.data.length - 1]).id);
  }, [lista.data, id]);
  const query = { ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), agrupar, ...(centro ? { centroCostoId: centro } : {}) };
  const q = useQuery({ queryKey: ['/presupuestos/comparacion', id, query], queryFn: () => api<Comparacion>(`/presupuestos/${id}/comparacion`, { query }), enabled: !!id });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Presupuesto contra real</Title>
        {id && <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(`/presupuestos/${id}/comparacion`, { ...query, formato: 'xlsx' }, 'presupuesto-real.xlsx')}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar(`/presupuestos/${id}/comparacion`, { ...query, formato: 'pdf' }, 'presupuesto-real.pdf')}>PDF</Button>
        </Group>}
      </Group>
      <Group mb="md" align="flex-end">
        <Select label="Presupuesto" w={240} allowDeselect={false} value={id} onChange={setId} data={(lista.data ?? []).map((p) => ({ value: p.id, label: `${p.nombre}${p.vigente ? ' (vigente)' : ''}` }))} />
        <TextInput label="Desde" type="month" w={160} value={desde || q.data?.desde || ''} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="month" w={160} value={hasta || q.data?.hasta || ''} onChange={(e) => setHasta(e.currentTarget.value)} />
        <SegmentedControl data={[{ value: 'cuenta', label: 'Cuenta' }, { value: 'rubro', label: 'Rubro' }, { value: 'centro', label: 'Centro de costo' }]} value={agrupar} onChange={setAgrupar} />
        <Select label="Centro de costo" w={200} clearable placeholder="Todos" data={centros} value={centro} onChange={setCentro} />
      </Group>
      {!lista.isLoading && !lista.data?.length && <Text c="dimmed">Todavía no hay presupuestos. Creá uno en Informes de gestión → Presupuestos.</Text>}
      {errorConsulta(q.error)}
      {q.data && <>
        <BarChart h={220} mb="md" dataKey="mes" data={q.data.serie.map((s) => ({ mes: mmaaaa(s.mes), presupuesto: Number(s.presupuesto), real: Number(s.real) }))} valueFormatter={(v) => formatoMoneda(v)} withLegend
          series={[{ name: 'presupuesto', label: 'Resultado presupuestado', color: 'gray.5' }, { name: 'real', label: 'Resultado real', color: 'indigo.6' }]} />
        <TablaComparacion datos={q.data} />
      </>}
    </Paper>
  );
}
