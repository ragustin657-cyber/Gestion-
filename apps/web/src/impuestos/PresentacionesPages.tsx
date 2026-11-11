import { Alert, Badge, Button, Group, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar, ErrorApi } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { cuerpoGenerar, MESES, NOMBRE_PRESENTACION, periodoTexto, TIPOS_PRESENTACION } from './comun';

export interface FilaPresentacion {
  id: string; tipo: string; periodo: string; quincena: number; nombreArchivo: string; registros: number; total: string;
  advertencias: string[]; generadoEn: string; cambiaron: boolean | null; error?: string;
}
type Controles = Record<string, { registros: number; total: string; iva: string }>;

const bajar = (p: { id: string; nombreArchivo: string }) => void descargar(`/impuestos/presentaciones/${p.id}/archivo`, {}, p.nombreArchivo);

export function TablaPresentaciones({ filas }: { filas: FilaPresentacion[] }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Presentación</Table.Th><Table.Th>Período</Table.Th><Table.Th>Generada</Table.Th><Table.Th ta="right">Registros</Table.Th><Table.Th>Archivo</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((p) => (
          <Table.Tr key={p.id}>
            <Table.Td>{NOMBRE_PRESENTACION[p.tipo] ?? p.tipo}</Table.Td>
            <Table.Td>{periodoTexto(p.periodo, p.quincena)}</Table.Td>
            <Table.Td>
              {formatoFecha(p.generadoEn)}
              {p.cambiaron && <Text size="xs" c="orange">{`Los datos del período cambiaron desde la generación del ${formatoFecha(p.generadoEn)}: corresponde rectificar`}</Text>}
              {p.cambiaron === false && <Badge size="xs" color="green" variant="light" ml="xs">al día</Badge>}
              {p.error && <Text size="xs" c="dimmed">{p.error}</Text>}
            </Table.Td>
            <Table.Td ta="right">{p.registros}</Table.Td>
            <Table.Td><Text size="xs">{p.nombreArchivo}</Text></Table.Td>
            <Table.Td><Button size="compact-xs" variant="light" onClick={() => bajar(p)}>Descargar</Button></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function PresentacionesPage() {
  const [tipo, setTipo] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['/impuestos/presentaciones', tipo], queryFn: () => api<FilaPresentacion[]>('/impuestos/presentaciones', { query: { tipo } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Presentaciones</Title>
      <Select label="Presentación" w={320} mb="md" clearable data={TIPOS_PRESENTACION} value={tipo} onChange={setTipo} />
      {q.isLoading ? <Text c="dimmed">Verificando los datos de cada período…</Text> : <TablaPresentaciones filas={q.data ?? []} />}
    </Paper>
  );
}

export function GenerarPresentacionPage() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<string>('LIBRO_IVA_DIGITAL');
  const [mes, setMes] = useState(hoy().slice(5, 7));
  const [anio, setAnio] = useState(hoy().slice(0, 4));
  const [quincena, setQuincena] = useState<string>('0');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ id: string; nombreArchivo: string; registros: number; total: string; advertencias: string[]; controles?: Controles } | null>(null);
  const conQuincena = tipo === 'SICORE' || tipo === 'ARBA';

  async function generar() {
    setError('');
    setEnviando(true);
    try {
      const r = await api<{ id: string; nombreArchivo: string; registros: number; total: string; advertencias: string[]; controles?: Controles }>('/impuestos/presentaciones', {
        metodo: 'POST', body: cuerpoGenerar(tipo, anio, mes, quincena),
      });
      setResultado(r);
      void qc.invalidateQueries({ queryKey: ['/impuestos/presentaciones'] });
      bajar(r);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Generar presentación</Title>
      <Group align="flex-end">
        <Select label="Presentación" w={320} allowDeselect={false} data={TIPOS_PRESENTACION} value={tipo} onChange={(v) => { setTipo(v ?? 'LIBRO_IVA_DIGITAL'); setQuincena('0'); setResultado(null); }} />
        <Select label="Mes" w={150} allowDeselect={false} data={MESES} value={mes} onChange={(v) => setMes(v ?? mes)} />
        <TextInput label="Año" w={90} value={anio} onChange={(e) => setAnio(e.currentTarget.value)} />
        {conQuincena && <Select label="Quincena" w={170} allowDeselect={false} value={quincena} onChange={(v) => setQuincena(v ?? '0')}
          data={[{ value: '0', label: 'Mes completo' }, { value: '1', label: '1ª quincena' }, ...(tipo === 'ARBA' ? [{ value: '2', label: '2ª quincena' }] : [])]} />}
        <Button loading={enviando} onClick={() => void generar()}>Generar</Button>
      </Group>
      {tipo === 'ARBA' && <Alert color="blue" mt="md">ARBA emite el comprobante de retención al procesar el lote (RN 22/25): entregue al proveedor el de ARBA.</Alert>}
      {error && <Alert color="red" mt="md">{error}</Alert>}
      {resultado && (
        <Stack mt="md" gap="xs">
          {resultado.controles
            ? <>
              <Text>{resultado.nombreArchivo} · {resultado.registros} registros</Text>
              {Object.entries(resultado.controles).map(([k, c]) => <Text key={k} size="sm">{`${k === 'ventas' ? 'Ventas' : 'Compras'}: ${c.registros} comprobantes · total ${formatoMoneda(c.total)} · IVA ${formatoMoneda(c.iva)} (en pesos, igual al libro)`}</Text>)}
            </>
            : <Text>{resultado.nombreArchivo} · {resultado.registros} registros · total {formatoMoneda(resultado.total)}</Text>}
          {resultado.advertencias.filter((a) => !a.startsWith('ARBA emite')).map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
          <Group><Button variant="light" onClick={() => bajar(resultado)}>Descargar de nuevo</Button></Group>
        </Stack>
      )}
      <Text size="xs" c="dimmed" mt="md">Los archivos siguen los diseños oficiales de ARCA, ARBA y AGIP. Verifique la primera importación en cada aplicativo.</Text>
    </Paper>
  );
}
