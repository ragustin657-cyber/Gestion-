import { JURISDICCIONES_CM } from '@gestion/shared';
import { Button, Group, Modal, NumberInput, Paper, Select, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconPlus, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';

export interface Recaudacion { id: string; periodo: string; jurisdiccion: string; nombre: string; importe: string; cbu: string | null; referencia: string | null }
const JURISDICCIONES = Object.entries(JURISDICCIONES_CM).map(([value, n]) => ({ value, label: `${value} ${n}` }));
const periodoActual = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function TablaRecaudaciones({ filas, editable, onEditar, onEliminar }: { filas: Recaudacion[]; editable: boolean; onEditar: (r: Recaudacion) => void; onEliminar: (r: Recaudacion) => void }) {
  const total = filas.reduce((t, r) => t + Number(r.importe), 0);
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th>CBU / referencia</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((r) => (
          <Table.Tr key={r.id}>
            <Table.Td>{`${r.jurisdiccion} ${r.nombre}`}</Table.Td><Table.Td>{[r.cbu, r.referencia].filter(Boolean).join(' · ')}</Table.Td><Table.Td ta="right">{formatoMoneda(r.importe)}</Table.Td>
            <Table.Td>{editable && <Group gap={4}>
              <Button size="compact-xs" variant="subtle" onClick={() => onEditar(r)}>Editar</Button>
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => onEliminar(r)}>Eliminar</Button>
            </Group>}</Table.Td>
          </Table.Tr>
        ))}
        {!filas.length && <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">Sin recaudaciones en el período</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
      {!!filas.length && <Table.Tfoot><Table.Tr><Table.Th colSpan={2}>Total</Table.Th><Table.Th ta="right">{formatoMoneda(total)}</Table.Th><Table.Th /></Table.Tr></Table.Tfoot>}
    </Table>
  );
}

/** Recaudaciones bancarias de IIBB (SIRCREB, E48): se restan en la liquidación de IIBB del período. */
export function RecaudacionesBancariasPage() {
  const qc = useQueryClient();
  const { puede } = useAuth();
  const op = useOperacion();
  const [periodo, setPeriodo] = useState(periodoActual());
  const [edicion, setEdicion] = useState<{ id: string | null; jurisdiccion: string | null; importe: number | string; referencia: string } | null>(null);
  const [importar, setImportar] = useState<string | null>(null);
  const valido = /^\d{4}(0[1-9]|1[0-2])$/.test(periodo);
  const q = useQuery({ queryKey: ['/impuestos/recaudaciones-bancarias', periodo], queryFn: () => api<Recaudacion[]>('/impuestos/recaudaciones-bancarias', { query: { periodo } }), enabled: valido });
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['/impuestos/recaudaciones-bancarias'] });
  const editable = puede('impuestos.presentar');
  const guardar = async () => {
    if (!edicion) return;
    const body = { periodo, jurisdiccion: edicion.jurisdiccion, importe: Number(edicion.importe) || 0, referencia: edicion.referencia || null };
    if (await op.ejecutar(() => api(edicion.id ? `/impuestos/recaudaciones-bancarias/${edicion.id}` : '/impuestos/recaudaciones-bancarias', { metodo: edicion.id ? 'PUT' : 'POST', body }), () => 'Recaudación guardada')) { setEdicion(null); refrescar(); }
  };
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Recaudaciones bancarias (SIRCREB)</Title>
        {editable && <Group gap="xs">
          <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} onClick={() => setImportar('')}>Importar</Button>
          <Button size="xs" leftSection={<IconPlus size={14} />} disabled={!valido} onClick={() => setEdicion({ id: null, jurisdiccion: null, importe: '', referencia: '' })}>Nueva recaudación</Button>
        </Group>}
      </Group>
      <TextInput label="Período (AAAAMM)" w={160} mb="sm" value={periodo} onChange={(e) => setPeriodo(e.currentTarget.value.trim())} error={!valido ? 'Período inválido' : undefined} />
      <Text size="xs" c="dimmed" mb="sm">Lo que el banco debitó por SIRCREB en el mes, por jurisdicción (de la consulta del sitio del Convenio). Se resta como pago a cuenta en la liquidación de IIBB del período.</Text>
      {errorConsulta(q.error)}
      {op.alerta}
      <TablaRecaudaciones filas={q.data ?? []} editable={editable} onEditar={(r) => setEdicion({ id: r.id, jurisdiccion: r.jurisdiccion, importe: Number(r.importe), referencia: r.referencia ?? '' })}
        onEliminar={(r) => void op.ejecutar(() => api(`/impuestos/recaudaciones-bancarias/${r.id}`, { metodo: 'DELETE' }), () => 'Recaudación eliminada').then((ok) => ok && refrescar())} />
      <Modal opened={!!edicion} onClose={() => setEdicion(null)} title={edicion?.id ? 'Modificar recaudación' : 'Nueva recaudación'}>
        {edicion && <Stack>
          <Select label="Jurisdicción" searchable data={JURISDICCIONES} value={edicion.jurisdiccion} onChange={(v) => setEdicion({ ...edicion, jurisdiccion: v })} />
          <NumberInput label="Importe" min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," value={edicion.importe} onChange={(v) => setEdicion({ ...edicion, importe: v })} />
          <TextInput label="Referencia" value={edicion.referencia} onChange={(e) => setEdicion({ ...edicion, referencia: e.currentTarget.value })} />
          {op.alerta}
          <Group><Button onClick={() => void guardar()}>Guardar</Button></Group>
        </Stack>}
      </Modal>
      <Modal opened={importar !== null} onClose={() => setImportar(null)} title="Importar recaudaciones">
        <Stack>
          <Text size="sm">Pegue la consulta de SIRCREB: una línea por recaudación con <code>periodo;jurisdiccion;importe[;cbu]</code>.</Text>
          <Textarea label="Contenido" autosize minRows={6} value={importar ?? ''} onChange={(e) => setImportar(e.currentTarget.value)} />
          {op.alerta}
          <Group><Button onClick={() => void op.ejecutar(() => api<{ importadas: number }>('/impuestos/recaudaciones-bancarias/importar', { metodo: 'POST', body: { texto: importar } }), (r) => `Importadas: ${r.importadas}`).then((ok) => { if (ok) { setImportar(null); refrescar(); } })}>Importar</Button></Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
