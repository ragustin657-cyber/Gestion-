import { Alert, Badge, Button, FileInput, Group, Paper, Select, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi, subirArchivo } from '../api/cliente';

interface Carga { id: string; jurisdiccion: string; periodo: string | null; archivo: string; estado: 'PROCESANDO' | 'COMPLETA' | 'ERROR'; filas: number; error: string | null; creadoEn: string }
const COLOR = { PROCESANDO: 'blue', COMPLETA: 'green', ERROR: 'red' } as const;
const JUR: Record<string, string> = { '901': 'CABA (AGIP)', '902': 'Buenos Aires (ARBA)' };

export function PadronesPage() {
  const [jurisdiccion, setJurisdiccion] = useState<string | null>('902');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const q = useQuery({
    queryKey: ['/padrones'],
    queryFn: () => api<Carga[]>('/padrones'),
    refetchInterval: (consulta) => ((consulta.state.data ?? []).some((c) => c.estado === 'PROCESANDO') ? 3000 : false),
  });
  async function cargar() {
    if (!archivo || !jurisdiccion) return;
    setError('');
    setSubiendo(true);
    try {
      await subirArchivo('/padrones', { jurisdiccion }, archivo);
      notifications.show({ color: 'blue', message: 'Padrón recibido: se está procesando' });
      setArchivo(null);
      void q.refetch();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    } finally {
      setSubiendo(false);
    }
  }
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="xs">Padrones de Ingresos Brutos</Title>
      <Text size="sm" c="dimmed" mb="md">Subí el archivo mensual que publica cada organismo. El padrón es único para todas las empresas del sistema.</Text>
      <Group align="flex-end" mb="md" wrap="wrap">
        <Select label="Jurisdicción" w={220} value={jurisdiccion} onChange={setJurisdiccion} data={Object.entries(JUR).map(([value, label]) => ({ value, label }))} />
        <FileInput label="Archivo del padrón (.txt)" w={320} value={archivo} onChange={setArchivo} accept=".txt,.TXT" placeholder="Elegir archivo" />
        <Button loading={subiendo} disabled={!archivo} onClick={cargar}>Cargar</Button>
      </Group>
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Jurisdicción</Table.Th><Table.Th>Período</Table.Th><Table.Th>Archivo</Table.Th><Table.Th>Estado</Table.Th><Table.Th ta="right">Filas</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>{new Date(c.creadoEn).toLocaleString('es-AR')}</Table.Td><Table.Td>{JUR[c.jurisdiccion] ?? c.jurisdiccion}</Table.Td><Table.Td>{c.periodo ?? ''}</Table.Td><Table.Td>{c.archivo}</Table.Td>
              <Table.Td><Badge size="sm" variant="light" color={COLOR[c.estado]}>{c.estado === 'PROCESANDO' ? 'Procesando' : c.estado === 'COMPLETA' ? 'Completa' : 'Error'}</Badge>{c.error && <Text size="xs" c="red">{c.error}</Text>}</Table.Td>
              <Table.Td ta="right">{c.filas.toLocaleString('es-AR')}</Table.Td>
            </Table.Tr>
          ))}
          {!q.data?.length && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" size="sm" ta="center">Todavía no se cargaron padrones</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
