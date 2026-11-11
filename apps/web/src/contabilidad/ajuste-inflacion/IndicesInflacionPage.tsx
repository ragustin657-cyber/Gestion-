import { ActionIcon, Button, FileButton, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, subirArchivo } from '../../api/cliente';
import { formatoFecha, hoy } from '../../compras/formato';
import { MESES } from '../../impuestos/comun';
import { errorConsulta, useOperacion } from '../../tesoreria/comun';

export interface Indice { anio: number; mes: number; valor: string; actualizadoEn: string }
const CLAVE = ['/indices-inflacion'];
const periodo = (i: { anio: number; mes: number }) => `${String(i.mes).padStart(2, '0')}/${i.anio}`;

function FilaIndice({ i, guardar, borrar }: { i: Indice; guardar: (i: Indice, valor: number) => void; borrar: (i: Indice) => void }) {
  const [valor, setValor] = useState<string | number>(i.valor);
  const cambiado = String(valor) !== i.valor && valor !== '';
  return (
    <Table.Tr>
      <Table.Td>{periodo(i)}</Table.Td>
      <Table.Td><NumberInput aria-label={`Índice ${periodo(i)}`} size="xs" w={160} decimalScale={6} decimalSeparator="," value={valor} onChange={setValor} /></Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{formatoFecha(i.actualizadoEn)}</Text></Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {cambiado && <Button size="compact-xs" onClick={() => guardar(i, Number(valor))}>Guardar</Button>}
          <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Borrar ${periodo(i)}`} onClick={() => borrar(i)}><IconTrash size={14} /></ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

export function IndicesInflacionPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CLAVE, queryFn: () => api<Indice[]>('/indices-inflacion') });
  const op = useOperacion();
  const [mes, setMes] = useState(hoy().slice(5, 7));
  const [anio, setAnio] = useState(hoy().slice(0, 4));
  const [valor, setValor] = useState<string | number>('');
  const refrescar = () => void qc.invalidateQueries({ queryKey: CLAVE });
  const guardar = async (a: number, m: number, v: number) => {
    if (await op.ejecutar(() => api(`/indices-inflacion/${a}/${m}`, { metodo: 'PUT', body: { valor: v } }), () => 'Índice guardado')) refrescar();
  };
  const borrar = async (i: Indice) => {
    if (await op.ejecutar(() => api(`/indices-inflacion/${i.anio}/${i.mes}`, { metodo: 'DELETE' }), () => `Índice ${periodo(i)} borrado`)) refrescar();
  };
  const importar = async (archivo: File | null) => {
    if (!archivo) return;
    const r = await op.ejecutar(() => subirArchivo<{ creados: number; actualizados: number }>('/indices-inflacion/importar', {}, archivo), (x) => `Creados: ${x.creados} · Actualizados: ${x.actualizados}`);
    if (r) refrescar();
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Índices de inflación</Title>
        <FileButton onChange={(f) => void importar(f)} accept=".csv,text/csv,text/plain">
          {(props) => <Button variant="light" {...props}>Importar CSV</Button>}
        </FileButton>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">IPC FACPCE mensual, compartido por todas las empresas. CSV: período (AAAA-MM o MM/AAAA) y valor, separados por punto y coma.</Text>
      <Group align="flex-end" mb="md">
        <Select label="Mes" w={150} allowDeselect={false} data={MESES} value={mes} onChange={(v) => setMes(v ?? mes)} />
        <TextInput label="Año" w={90} value={anio} onChange={(e) => setAnio(e.currentTarget.value)} />
        <NumberInput label="Valor" w={160} decimalScale={6} decimalSeparator="," value={valor} onChange={setValor} />
        <Button loading={op.enviando} disabled={valor === ''} onClick={() => void guardar(Number(anio), Number(mes), Number(valor))}>Agregar</Button>
      </Group>
      {op.alerta}
      {errorConsulta(q.error)}
      <Table withTableBorder striped mt="sm">
        <Table.Thead><Table.Tr><Table.Th>Período</Table.Th><Table.Th>Valor</Table.Th><Table.Th>Actualizado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((i) => <FilaIndice key={`${i.anio}-${i.mes}-${i.valor}`} i={i} guardar={(x, v) => void guardar(x.anio, x.mes, v)} borrar={(x) => void borrar(x)} />)}
        </Table.Tbody>
      </Table>
      {q.data?.length === 0 && <Text c="dimmed" mt="sm">No hay índices cargados.</Text>}
    </Paper>
  );
}
