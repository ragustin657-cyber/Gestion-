import { Alert, Button, Checkbox, Group, Paper, Select, Table, TextInput, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';

type Importes = { origenInicio: string; altas: string; bajas: string; origenCierre: string; amortInicio: string; amortBajas: string; amortEjercicio: string; amortCierre: string; neto: string };
export interface Planilla { fecha: string; aviso?: string; filas: (Importes & { rubroId: string; rubro: string })[]; totales: Importes; control: { origen: string; amortizacion: string } }
const COLS: [keyof Importes, string][] = [['origenInicio', 'Origen al inicio'], ['altas', 'Altas'], ['bajas', 'Bajas'], ['origenCierre', 'Origen al cierre'], ['amortInicio', 'Amort. al inicio'], ['amortBajas', 'Amort. bajas'], ['amortEjercicio', 'Amort. del ejercicio'], ['amortCierre', 'Amort. al cierre'], ['neto', 'Neto']];

export function TablaPlanilla({ datos, reexpresada = false }: { datos: Planilla; reexpresada?: boolean }) {
  const ok = Number(datos.control.origen) === 0 && Number(datos.control.amortizacion) === 0;
  return <>
    <Table.ScrollContainer minWidth={1000}>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Rubro</Table.Th>{COLS.map(([, t]) => <Table.Th key={t} ta="right">{t}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{datos.filas.map((f) => <Table.Tr key={f.rubroId}><Table.Td>{f.rubro}</Table.Td>{COLS.map(([k]) => <Table.Td key={k} ta="right">{formatoMoneda(f[k])}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
        <Table.Tfoot><Table.Tr data-testid="fila-total"><Table.Th>Total</Table.Th>{COLS.map(([k]) => <Table.Th key={k} ta="right">{formatoMoneda(datos.totales[k])}</Table.Th>)}</Table.Tr></Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
    {!reexpresada && (ok
      ? <Alert color="green" mt="sm">Coincide con el Mayor</Alert>
      : <Alert color="orange" mt="sm">{`Diferencia con el Mayor: valor de origen ${formatoMoneda(datos.control.origen)} · amortizaciones ${formatoMoneda(datos.control.amortizacion)}`}</Alert>)}
  </>;
}

export function PlanillaBienesPage() {
  const ejercicios = useQuery({ queryKey: ['/contabilidad/ejercicios'], queryFn: () => api<{ id: string; numero: number; desde: string; hasta: string; estado: string }[]>('/contabilidad/ejercicios') });
  const [ejercicioId, setEjercicioId] = useState<string | null>(null);
  const [fecha, setFecha] = useState('');
  const [reexpresar, setReexpresar] = useState(false);
  useEffect(() => {
    if (!ejercicioId && ejercicios.data?.length) {
      const e = ejercicios.data.find((x) => x.estado === 'ABIERTO') ?? ejercicios.data[0];
      setEjercicioId(e.id);
      setFecha(e.hasta.slice(0, 10));
    }
  }, [ejercicios.data, ejercicioId]);
  const query = { ejercicioId: ejercicioId ?? '', fecha, reexpresar: String(reexpresar) };
  const q = useQuery({ queryKey: ['/bienes-uso/planilla', query], queryFn: () => api<Planilla>('/bienes-uso/planilla', { query }), enabled: !!ejercicioId && !!fecha });
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Planilla de bienes de uso</Title>
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/bienes-uso/planilla', { ...query, formato: 'xlsx' }, `planilla-bienes-${fecha}.xlsx`)}>Excel</Button>
          <Button variant="light" size="xs" leftSection={<IconDownload size={14} />} onClick={() => void descargar('/bienes-uso/planilla', { ...query, formato: 'pdf' }, `planilla-bienes-${fecha}.pdf`)}>PDF</Button>
        </Group>
      </Group>
      <Group mb="md" align="flex-end">
        <Select label="Ejercicio" w={220} allowDeselect={false} value={ejercicioId} data={(ejercicios.data ?? []).map((e) => ({ value: e.id, label: `Ejercicio ${e.numero} (${e.hasta.slice(0, 4)})` }))}
          onChange={(v) => { const e = ejercicios.data?.find((x) => x.id === v); setEjercicioId(v); if (e) setFecha(e.hasta.slice(0, 10)); }} />
        <TextInput label="Al" type="date" w={170} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
        <Checkbox label="En moneda de cierre" checked={reexpresar} onChange={(e) => setReexpresar(e.currentTarget.checked)} mb={8} />
      </Group>
      {errorConsulta(q.error)}
      {q.data?.aviso && <Alert color="orange" mb="sm">{q.data.aviso}</Alert>}
      {q.data && <TablaPlanilla datos={q.data} reexpresada={reexpresar} />}
    </Paper>
  );
}
