import { JURISDICCIONES_CM } from '@gestion/shared';
import { Alert, Badge, Button, FileInput, Group, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi, subirArchivo } from '../api/cliente';

interface Carga { id: string; jurisdiccion: string; periodo: string | null; archivo: string; estado: 'PROCESANDO' | 'COMPLETA' | 'ERROR'; filas: number; error: string | null; creadoEn: string }
const COLOR = { PROCESANDO: 'blue', COMPLETA: 'green', ERROR: 'red' } as const;
/** E48: cualquier jurisdicción; 901 y 902 con los formatos fijos de AGIP y ARBA, las demás con su formato configurado. */
const JUR: Record<string, string> = { ...Object.fromEntries(Object.entries(JURISDICCIONES_CM).map(([j, n]) => [j, `${j} ${n}`])), '901': '901 CABA (AGIP)', '902': '902 Buenos Aires (ARBA)' };
type Formato = { separador: string; encabezado: boolean; cuit: string; alicuotaPercepcion: string; alicuotaRetencion: string; vigenciaDesde: string; vigenciaHasta: string; formatoFecha: string; separadorDecimal: string };
const FORMATO_VACIO: Formato = { separador: ';', encabezado: false, cuit: '1', alicuotaPercepcion: '', alicuotaRetencion: '', vigenciaDesde: '', vigenciaHasta: '', formatoFecha: 'DD/MM/AAAA', separadorDecimal: '.' };

/** Formato del padrón de una jurisdicción (E48): columnas (1 = la primera) o posiciones «desde-hasta» en ancho fijo. */
export function FormatoPadronForm({ jurisdiccion, onCerrar }: { jurisdiccion: string; onCerrar: () => void }) {
  const q = useQuery({ queryKey: ['/padrones/formatos', jurisdiccion], queryFn: () => api<Partial<Formato>>(`/padrones/formatos/${jurisdiccion}`) });
  const [f, setF] = useState<Formato | null>(null);
  const [error, setError] = useState('');
  const v = f ?? (q.data ? { ...FORMATO_VACIO, ...Object.fromEntries(Object.entries(q.data).map(([k, x]) => [k, x ?? ''])) } as Formato : null);
  if (!v) return null;
  const campo = (k: keyof Formato, label: string) => <TextInput label={label} w={130} value={String(v[k])} onChange={(e) => setF({ ...v, [k]: e.currentTarget.value })} />;
  const guardar = async () => {
    setError('');
    try {
      await api(`/padrones/formatos/${jurisdiccion}`, { metodo: 'PUT', body: { ...v, ...Object.fromEntries((['alicuotaPercepcion', 'alicuotaRetencion', 'vigenciaDesde', 'vigenciaHasta'] as const).map((k) => [k, v[k] || null])) } });
      notifications.show({ color: 'green', message: 'Formato guardado' });
      onCerrar();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  return (
    <Stack>
      <Group>
        <Select label="Separador" w={150} allowDeselect={false} value={v.separador} onChange={(x) => setF({ ...v, separador: x ?? ';' })}
          data={[{ value: ';', label: 'Punto y coma' }, { value: ',', label: 'Coma' }, { value: '|', label: 'Barra' }, { value: 'TAB', label: 'Tabulador' }, { value: 'FIJO', label: 'Ancho fijo' }]} />
        <Switch label="Tiene encabezado" mt="lg" checked={v.encabezado} onChange={(e) => setF({ ...v, encabezado: e.currentTarget.checked })} />
      </Group>
      <Text size="xs" c="dimmed">{v.separador === 'FIJO' ? 'Posiciones desde-hasta, por ejemplo 1-11.' : 'Número de columna: 1 es la primera.'} Las vigencias son opcionales: si faltan, se usa el mes que se indique al cargar.</Text>
      <Group>{campo('cuit', 'CUIT')}{campo('alicuotaRetencion', 'Alícuota retención')}{campo('alicuotaPercepcion', 'Alícuota percepción')}</Group>
      <Group>{campo('vigenciaDesde', 'Vigencia desde')}{campo('vigenciaHasta', 'Vigencia hasta')}
        <Select label="Formato de fecha" w={150} allowDeselect={false} value={v.formatoFecha} onChange={(x) => setF({ ...v, formatoFecha: x ?? 'DD/MM/AAAA' })} data={['DDMMAAAA', 'DD/MM/AAAA', 'AAAAMMDD', 'AAAA-MM-DD']} />
        <Select label="Decimales" w={120} allowDeselect={false} value={v.separadorDecimal} onChange={(x) => setF({ ...v, separadorDecimal: x ?? '.' })} data={[{ value: '.', label: 'Punto' }, { value: ',', label: 'Coma' }]} />
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Group><Button onClick={() => void guardar()}>Guardar formato</Button></Group>
    </Stack>
  );
}

export function PadronesPage() {
  const [jurisdiccion, setJurisdiccion] = useState<string | null>('902');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [periodo, setPeriodo] = useState('');
  const [formato, setFormato] = useState(false);
  const fija = jurisdiccion === '901' || jurisdiccion === '902';
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
      await subirArchivo('/padrones', { jurisdiccion, ...(periodo ? { periodo } : {}) }, archivo);
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
        <Select label="Jurisdicción" w={240} searchable value={jurisdiccion} onChange={setJurisdiccion} data={Object.entries(JUR).map(([value, label]) => ({ value, label }))} />
        {!fija && <TextInput label="Período (AAAAMM, si el archivo no trae vigencia)" w={260} value={periodo} onChange={(e) => setPeriodo(e.currentTarget.value.trim())} />}
        {!fija && jurisdiccion && <Button variant="light" onClick={() => setFormato(true)}>Formato del padrón</Button>}
        <FileInput label="Archivo del padrón" w={320} value={archivo} onChange={setArchivo} accept=".txt,.TXT,.csv,.CSV" placeholder="Elegir archivo" />
        <Button loading={subiendo} disabled={!archivo} onClick={cargar}>Cargar</Button>
      </Group>
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Modal opened={formato && !!jurisdiccion} onClose={() => setFormato(false)} title={`Formato del padrón: ${JUR[jurisdiccion ?? ''] ?? ''}`} size="lg">
        {jurisdiccion && <FormatoPadronForm key={jurisdiccion} jurisdiccion={jurisdiccion} onCerrar={() => setFormato(false)} />}
      </Modal>
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
