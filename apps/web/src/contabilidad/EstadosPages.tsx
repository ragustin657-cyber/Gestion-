import { Button, Checkbox, Group, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';

interface Fila { codigo: string; nombre: string; nivel: number; importe: string; importeAnterior?: string }
interface Bloque { total: string; filas: Fila[] }

function TablaBloque({ titulo, b, comparativo, anterior }: { titulo: string; b: Bloque; comparativo: boolean; anterior?: string }) {
  return (
    <Table withTableBorder mb="sm">
      <Table.Thead><Table.Tr><Table.Th>{titulo}</Table.Th><Table.Th ta="right" w={160}>Actual</Table.Th>{comparativo && <Table.Th ta="right" w={160}>Anterior</Table.Th>}</Table.Tr></Table.Thead>
      <Table.Tbody>
        {b.filas.map((f) => (
          <Table.Tr key={f.codigo}><Table.Td><Text size="sm" pl={(f.nivel - 1) * 12} fw={f.nivel <= 2 ? 700 : 400}>{f.codigo} {f.nombre}</Text></Table.Td>
            <Table.Td ta="right">{formatoMoneda(f.importe)}</Table.Td>{comparativo && <Table.Td ta="right">{formatoMoneda(f.importeAnterior ?? '0')}</Table.Td>}</Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot><Table.Tr><Table.Th>Total {titulo.toLowerCase()}</Table.Th><Table.Th ta="right">{formatoMoneda(b.total)}</Table.Th>{comparativo && <Table.Th ta="right">{formatoMoneda(anterior ?? '0')}</Table.Th>}</Table.Tr></Table.Tfoot>
    </Table>
  );
}

interface Situacion {
  fecha: string; activo: Bloque; pasivo: Bloque; patrimonioNeto: Bloque; resultadoEnCurso: string | null; control: string;
  comparativo: { fecha: string; activo: string; pasivo: string; patrimonioNeto: string; coeficiente?: string } | null;
}

export function SituacionPage() {
  const [fecha, setFecha] = useState(hoy());
  const [nivel, setNivel] = useState<string | null>('3');
  const [reexpresado, setReexpresado] = useState(false);
  const query = { fecha, nivel: nivel ?? undefined, comparativoReexpresado: reexpresado ? 'true' : undefined };
  const q = useQuery({ queryKey: ['/contabilidad/estados/situacion', query], queryFn: () => api<Situacion>('/contabilidad/estados/situacion', { query }), enabled: !!fecha });
  const s = q.data;
  const comp = !!s?.comparativo;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Estado de situación patrimonial</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/contabilidad/estados/situacion', { ...query, formato: 'pdf' }, 'estado-situacion.pdf')}>PDF</Button>
      </Group>
      <Group mb="md"><TextInput label="Al" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} /><Select label="Nivel" w={100} value={nivel} onChange={setNivel} data={['1', '2', '3', '4', '5']} />
        <Checkbox label="Comparativo reexpresado" checked={reexpresado} onChange={(e) => setReexpresado(e.currentTarget.checked)} mb={8} /></Group>
      {errorConsulta(q.error)}
      {s && (
        <Stack gap={0}>
          {comp && <Text size="sm" c="dimmed" mb="xs">Comparativo al {formatoFecha(s.comparativo!.fecha)}{s.comparativo!.coeficiente && ` reexpresado (coeficiente ${s.comparativo!.coeficiente.replace('.', ',')})`}</Text>}
          <TablaBloque titulo="Activo" b={s.activo} comparativo={comp} anterior={s.comparativo?.activo} />
          <TablaBloque titulo="Pasivo" b={s.pasivo} comparativo={comp} anterior={s.comparativo?.pasivo} />
          <TablaBloque titulo="Patrimonio neto" b={s.patrimonioNeto} comparativo={comp} anterior={s.comparativo?.patrimonioNeto} />
          {s.resultadoEnCurso && <Text size="sm">Incluye el resultado del ejercicio en curso: <b>{formatoMoneda(s.resultadoEnCurso)}</b></Text>}
          <Text fw={700} mt="sm">Pasivo + patrimonio neto: {formatoMoneda(Number(s.pasivo.total) + Number(s.patrimonioNeto.total))}</Text>
          <Text size="sm" c={s.control === '0' ? 'green' : 'red'} data-testid="control-balance">Control (activo − pasivo − PN): {formatoMoneda(s.control)}</Text>
        </Stack>
      )}
    </Paper>
  );
}

interface Resultados { positivos: Bloque; negativos: Bloque; resultado: string; comparativo: { positivos: Bloque; negativos: Bloque; resultado: string; coeficiente?: string } | null }

export function ResultadosPage() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [nivel, setNivel] = useState<string | null>('3');
  const [reexpresado, setReexpresado] = useState(false);
  const query = { desde: desde || undefined, hasta: hasta || undefined, nivel: nivel ?? undefined, comparativoReexpresado: reexpresado ? 'true' : undefined };
  const q = useQuery({ queryKey: ['/contabilidad/estados/resultados', query], queryFn: () => api<Resultados>('/contabilidad/estados/resultados', { query }) });
  const r = q.data;
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Estado de resultados</Title>
        <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/contabilidad/estados/resultados', { ...query, formato: 'pdf' }, 'estado-resultados.pdf')}>PDF</Button>
      </Group>
      <Group mb="md"><TextInput label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} /><TextInput label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <Select label="Nivel" w={100} value={nivel} onChange={setNivel} data={['1', '2', '3', '4', '5']} />
        <Checkbox label="Comparativo reexpresado" checked={reexpresado} onChange={(e) => setReexpresado(e.currentTarget.checked)} mb={8} /></Group>
      <Text size="xs" c="dimmed" mb="sm">Sin fechas: el ejercicio en curso. Los importes incluyen los ajustes por inflación registrados.</Text>
      {errorConsulta(q.error)}
      {r && (
        <Stack gap={0}>
          <TablaBloque titulo="Resultados positivos" b={r.positivos} comparativo={false} />
          <TablaBloque titulo="Resultados negativos" b={r.negativos} comparativo={false} />
          <Text fw={700} size="lg" data-testid="resultado-periodo">Resultado del período: {formatoMoneda(r.resultado)}</Text>
          {r.comparativo && <Text size="sm" c="dimmed">Ejercicio anterior, mismo período{r.comparativo.coeficiente ? ' (reexpresado)' : ''}: {formatoMoneda(r.comparativo.resultado)}</Text>}
        </Stack>
      )}
    </Paper>
  );
}
