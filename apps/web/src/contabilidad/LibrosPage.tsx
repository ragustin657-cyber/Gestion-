import { Alert, Button, Group, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { finDelMes, primeroDelMes } from '../compras/consultas/comun';
import { formatoFecha } from '../compras/formato';
import { descargarPost, useEjercicios } from './comun';

interface Emision { id: string; libro: 'DIARIO' | 'INVENTARIOS'; desde: string; hasta: string; folioInicial: number; folioFinal: number; fecha: string }

export function LibrosPage() {
  const ejercicios = useEjercicios();
  const historial = useQuery({ queryKey: ['/contabilidad/libros/emisiones'], queryFn: () => api<Emision[]>('/contabilidad/libros/emisiones') });
  const ultimo = (libro: string) => Math.max(0, ...(historial.data ?? []).filter((e) => e.libro === libro).map((e) => e.folioFinal)) + 1;
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(finDelMes());
  const [folio, setFolio] = useState('');
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [folioInv, setFolioInv] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  async function emitir(ruta: string, body: object, nombre: string) {
    setError('');
    setAviso('');
    try {
      const h = await descargarPost(ruta, body, nombre);
      notifications.show({ color: 'green', message: `Libro emitido: folios ${h.get('X-Folio-Inicial')} a ${h.get('X-Folio-Final')}` });
      if (h.get('X-Advertencia')) setAviso(h.get('X-Advertencia')!);
      void historial.refetch();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  }
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Libros legales</Title>
        <Title order={5}>Libro Diario</Title>
        <Text size="xs" c="dimmed" mb="xs">Solo meses cerrados. El folio se propone a continuación del último emitido; ajústelo a la hoja rubricada si hace falta.</Text>
        <Group align="flex-end">
          <TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
          <TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
          <TextInput label="Folio inicial" w={120} placeholder={String(ultimo('DIARIO'))} value={folio} onChange={(e) => setFolio(e.currentTarget.value)} />
          <Button onClick={() => void emitir('/contabilidad/libros/diario', { desde, hasta, folioInicial: folio ? Number(folio) : null }, `libro-diario-${desde}.pdf`)}>Emitir Libro Diario</Button>
        </Group>
        <Title order={5} mt="lg">Libro de Inventarios y Balances</Title>
        <Group align="flex-end">
          <Select label="Ejercicio cerrado" w={220} value={ejercicioId} onChange={setEjercicioId} data={(ejercicios.data ?? []).filter((e) => e.estado === 'CERRADO').map((e) => ({ value: e.id, label: `Ejercicio ${e.numero}` }))} />
          <TextInput label="Folio inicial" w={120} placeholder={String(ultimo('INVENTARIOS'))} value={folioInv} onChange={(e) => setFolioInv(e.currentTarget.value)} />
          <Button disabled={!ejercicioId} onClick={() => void emitir('/contabilidad/libros/inventarios', { ejercicioId, folioInicial: folioInv ? Number(folioInv) : null }, 'libro-inventarios-y-balances.pdf')}>Emitir</Button>
        </Group>
        {aviso && <Alert color="yellow" mt="md">{aviso}</Alert>}
        {error && <Alert color="red" mt="md">{error}</Alert>}
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Emisiones</Title>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Libro</Table.Th><Table.Th>Período</Table.Th><Table.Th>Folios</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(historial.data ?? []).map((e) => (
              <Table.Tr key={e.id}><Table.Td>{formatoFecha(e.fecha)}</Table.Td><Table.Td>{e.libro === 'DIARIO' ? 'Diario' : 'Inventarios y Balances'}</Table.Td>
                <Table.Td>{formatoFecha(e.desde)} al {formatoFecha(e.hasta)}</Table.Td><Table.Td>{e.folioInicial} a {e.folioFinal}</Table.Td></Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
