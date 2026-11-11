import { Alert, Badge, Button, FileInput, Group, Paper, SegmentedControl, Stack, Table, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { sesion } from '../auth/sesion';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';

interface Fila { fecha: string; tipo: number; puntoVenta: number; numero: number; documento: string; total?: string; arca?: { total: string }; sistema?: { total: string } }
interface Resultado { coinciden: number; soloArca: Fila[]; soloSistema: Fila[]; diferencias: Fila[] }

async function enviar(form: Record<string, string>, archivo: File, formato?: string): Promise<Response> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  fd.append('archivo', archivo);
  const token = sesion.leer()?.token;
  return fetch(`/api/impuestos/control-arca${formato ? `?formato=${formato}` : ''}`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function TablaFilas({ titulo, filas, color, diferencias }: { titulo: string; filas: Fila[]; color: string; diferencias?: boolean }) {
  return (
    <Stack gap={4}>
      <Group gap="xs"><Title order={5}>{titulo}</Title><Badge color={color}>{filas.length}</Badge></Group>
      {!!filas.length && (
        <Table withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Comprobante</Table.Th><Table.Th>Documento</Table.Th>
            {diferencias ? <><Table.Th ta="right">Total ARCA</Table.Th><Table.Th ta="right">Total sistema</Table.Th></> : <Table.Th ta="right">Total</Table.Th>}</Table.Tr></Table.Thead>
          <Table.Tbody>{filas.map((f, i) => (
            <Table.Tr key={i}><Table.Td>{formatoFecha(f.fecha)}</Table.Td><Table.Td>{String(f.tipo).padStart(3, '0')}</Table.Td>
              <Table.Td>{`${String(f.puntoVenta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`}</Table.Td><Table.Td>{f.documento}</Table.Td>
              {diferencias ? <><Table.Td ta="right">{formatoMoneda(f.arca?.total)}</Table.Td><Table.Td ta="right">{formatoMoneda(f.sistema?.total)}</Table.Td></> : <Table.Td ta="right">{formatoMoneda(f.total)}</Table.Td>}
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

export function ControlArcaPage() {
  const [sentido, setSentido] = useState('RECIBIDOS');
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [r, setR] = useState<Resultado | null>(null);
  const form = () => ({ sentido, desde, hasta });

  async function controlar() {
    setError('');
    const res = await enviar(form(), archivo!);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.message ?? 'No se pudo controlar el archivo'); setR(null); return; }
    setR(d);
  }
  async function excel() {
    const res = await enviar(form(), archivo!, 'xlsx');
    if (!res.ok) return setError('No se pudo generar el Excel');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `control-arca-${desde}-${hasta}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Control con Mis Comprobantes de ARCA</Title>
      <Group align="flex-end">
        <SegmentedControl value={sentido} onChange={setSentido} data={[{ value: 'RECIBIDOS', label: 'Recibidos (compras)' }, { value: 'EMITIDOS', label: 'Emitidos (ventas)' }]} />
        <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <FileInput label="CSV descargado de Mis Comprobantes" w={300} accept=".csv,.txt" value={archivo} onChange={setArchivo} />
        <Button disabled={!archivo} onClick={() => void controlar()}>Controlar</Button>
        {r && <Button variant="default" onClick={() => void excel()}>Excel</Button>}
      </Group>
      {error && <Alert color="red" mt="md">{error}</Alert>}
      {r && (
        <Stack mt="md">
          <Badge color="green" size="lg">{`Coinciden: ${r.coinciden}`}</Badge>
          <TablaFilas titulo="En ARCA y no en el sistema" filas={r.soloArca} color="red" />
          <TablaFilas titulo="En el sistema y no en ARCA" filas={r.soloSistema} color="orange" />
          <TablaFilas titulo="Con diferencias" filas={r.diferencias} color="yellow" diferencias />
        </Stack>
      )}
    </Paper>
  );
}
