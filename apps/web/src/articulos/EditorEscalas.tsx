import { ActionIcon, Alert, Button, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { numero } from '../ventas/comun';

/** E56: escalas de descuento por cantidad de un rubro o artículo (la lista completa se guarda junta). */
export function EditorEscalas({ url, aviso }: { url: string; aviso?: string | null }) {
  const qc = useQueryClient();
  const actuales = useQuery({ queryKey: [url], queryFn: () => api<{ desde: string; porcentaje: string }[]>(url) });
  const [filas, setFilas] = useState<{ desde: string; porcentaje: string }[]>([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [cargado, setCargado] = useState(false);
  // Se cargan una sola vez: lo que el usuario está editando no se pisa con una respuesta tardía
  useEffect(() => {
    if (actuales.data && !cargado) { setFilas(actuales.data.map((e) => ({ desde: String(Number(e.desde)), porcentaje: String(Number(e.porcentaje)) }))); setCargado(true); }
  }, [actuales.data, cargado]);
  const cambiar = (i: number, c: Partial<{ desde: string; porcentaje: string }>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...c } : f)));
  const guardar = async () => {
    setError('');
    setGuardando(true);
    try {
      await api(url, { metodo: 'PUT', body: { escalas: filas.filter((f) => f.desde.trim() || f.porcentaje.trim()).map((f) => ({ desde: numero(f.desde), porcentaje: numero(f.porcentaje) })) } });
      notifications.show({ color: 'green', message: 'Escalas guardadas' });
      void qc.invalidateQueries({ queryKey: [url] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Stack gap="xs">
      {aviso && !filas.length && <Text size="sm" c="dimmed">{aviso}</Text>}
      {filas.length > 0 && (
        <Table withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>Desde cantidad</Table.Th><Table.Th>% de descuento</Table.Th><Table.Th w={40} /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {filas.map((f, i) => (
              <Table.Tr key={i}>
                <Table.Td><TextInput size="xs" inputMode="decimal" aria-label={`Desde cantidad ${i + 1}`} value={f.desde} onChange={(e) => cambiar(i, { desde: e.currentTarget.value })} /></Table.Td>
                <Table.Td><TextInput size="xs" inputMode="decimal" aria-label={`% de descuento ${i + 1}`} value={f.porcentaje} onChange={(e) => cambiar(i, { porcentaje: e.currentTarget.value })} /></Table.Td>
                <Table.Td><ActionIcon variant="subtle" color="red" aria-label={`Quitar escala ${i + 1}`} onClick={() => setFilas(filas.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between">
        <Button size="xs" variant="default" disabled={!cargado} onClick={() => setFilas([...filas, { desde: '', porcentaje: '' }])}>Agregar escala</Button>
        <Button size="xs" loading={guardando} onClick={() => void guardar()}>Guardar escalas</Button>
      </Group>
    </Stack>
  );
}
