import { ActionIcon, Alert, Button, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { JURISDICCIONES_CM } from '@gestion/shared';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';

export interface FilaJurisdiccionCm { jurisdiccion: string; coeficiente: number; alicuota: number; actividad: string; saldoInicial: number }
const OPCIONES = Object.entries(JURISDICCIONES_CM).map(([value, n]) => ({ value, label: `${value} - ${n}` }));

/** Tabla editable de las jurisdicciones del año con la suma de coeficientes (spec E38 §8). */
export function TablaJurisdiccionesCm({ filas, conSaldoInicial, onChange }: { filas: FilaJurisdiccionCm[]; conSaldoInicial: boolean; onChange: (f: FilaJurisdiccionCm[]) => void }) {
  const cambiar = (i: number, c: Partial<FilaJurisdiccionCm>) => onChange(filas.map((f, j) => (j === i ? { ...f, ...c } : f)));
  const suma = filas.reduce((t, f) => t + (Number(f.coeficiente) || 0), 0);
  return (
    <Stack gap="xs">
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th>Coeficiente</Table.Th><Table.Th>Alícuota %</Table.Th><Table.Th>Actividad (NAES)</Table.Th>{conSaldoInicial && <Table.Th>Saldo inicial</Table.Th>}<Table.Th /></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map((f, i) => (
            <Table.Tr key={i}>
              <Table.Td><Select aria-label="Jurisdicción" w={190} data={OPCIONES} value={f.jurisdiccion} allowDeselect={false} searchable onChange={(v) => cambiar(i, { jurisdiccion: v ?? f.jurisdiccion })} /></Table.Td>
              <Table.Td><NumberInput aria-label="Coeficiente" w={110} min={0} max={1} decimalScale={6} value={f.coeficiente} onChange={(v) => cambiar(i, { coeficiente: Number(v) || 0 })} /></Table.Td>
              <Table.Td><NumberInput aria-label="Alícuota" w={90} min={0} max={100} decimalScale={4} value={f.alicuota} onChange={(v) => cambiar(i, { alicuota: Number(v) || 0 })} /></Table.Td>
              <Table.Td><TextInput aria-label="Actividad" w={110} value={f.actividad} onChange={(e) => cambiar(i, { actividad: e.currentTarget.value })} /></Table.Td>
              {conSaldoInicial && <Table.Td><NumberInput aria-label="Saldo inicial" w={130} min={0} decimalScale={2} value={f.saldoInicial} onChange={(v) => cambiar(i, { saldoInicial: Number(v) || 0 })} /></Table.Td>}
              <Table.Td><ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => onChange(filas.filter((_, j) => j !== i))}>✕</ActionIcon></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm" c={Math.abs(suma - 1) > 0.0001 ? 'red' : undefined}>{`Suma de coeficientes: ${suma.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}</Text>
    </Stack>
  );
}

/** Impuestos → Configuración: jurisdicciones del Convenio Multilateral de un año. */
export function JurisdiccionesCm({ inicioAnio }: { inicioAnio: number | null }) {
  const qc = useQueryClient();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['/impuestos/iibb/jurisdicciones', anio], queryFn: () => api<{ jurisdiccion: string; coeficiente: string; alicuota: string; actividad: string; saldoInicial: string }[]>('/impuestos/iibb/jurisdicciones', { query: { anio: String(anio) } }) });
  const [filas, setFilas] = useState<FilaJurisdiccionCm[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { if (q.data) setFilas(q.data.map((j) => ({ jurisdiccion: j.jurisdiccion, coeficiente: Number(j.coeficiente), alicuota: Number(j.alicuota), actividad: j.actividad, saldoInicial: Number(j.saldoInicial) }))); }, [q.data]);
  const conSaldoInicial = !inicioAnio || inicioAnio === anio;
  const guardar = async () => {
    setError('');
    try {
      await api(`/impuestos/iibb/jurisdicciones?anio=${anio}`, { metodo: 'PUT', body: { jurisdicciones: filas.map((f) => ({ ...f, saldoInicial: conSaldoInicial ? f.saldoInicial : 0 })) } });
      notifications.show({ color: 'green', message: 'Jurisdicciones guardadas' });
      void qc.invalidateQueries({ queryKey: ['/impuestos/iibb/jurisdicciones', anio] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={5}>Jurisdicciones del Convenio Multilateral</Title>
        <Select aria-label="Año de las jurisdicciones" w={100} data={[anio - 1, anio, anio + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
      </Group>
      <TablaJurisdiccionesCm filas={filas} conSaldoInicial={conSaldoInicial} onChange={setFilas} />
      <Text size="xs" c="dimmed">Coeficientes unificados del CM05 del año. El saldo inicial (saldo a favor al comienzo del primer mes liquidado) solo se carga en el año de inicio.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <Group>
        <Button variant="default" onClick={() => setFilas([...filas, { jurisdiccion: OPCIONES.find((o) => !filas.some((f) => f.jurisdiccion === o.value))?.value ?? '901', coeficiente: 0, alicuota: 0, actividad: '', saldoInicial: 0 }])}>Agregar jurisdicción</Button>
        <Button onClick={() => void guardar()}>Guardar jurisdicciones</Button>
      </Group>
    </Stack>
  );
}
