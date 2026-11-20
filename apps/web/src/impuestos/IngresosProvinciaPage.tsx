import { Alert, Button, Group, Paper, Select, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, descargar } from '../api/cliente';
import { formatoMoneda } from '../compras/formato';
import { errorConsulta } from '../tesoreria/comun';

export interface IngresosProvincia { anio: number; total: string; avisos: string[]; filas: { jurisdiccion: string | null; nombre: string; ingresos: string; porcentaje: string }[] }
const pct = (x: string) => `${Number(x).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

export function TablaIngresosProvincia({ r }: { r: IngresosProvincia }) {
  return (
    <Table withTableBorder striped>
      <Table.Thead><Table.Tr><Table.Th>Jurisdicción</Table.Th><Table.Th ta="right">Ingresos</Table.Th><Table.Th ta="right">% del total</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {r.filas.map((f) => <Table.Tr key={f.nombre}><Table.Td>{f.nombre}</Table.Td><Table.Td ta="right">{formatoMoneda(f.ingresos)}</Table.Td><Table.Td ta="right">{pct(f.porcentaje)}</Table.Td></Table.Tr>)}
        <Table.Tr fw={700}><Table.Td>Total</Table.Td><Table.Td ta="right">{formatoMoneda(r.total)}</Table.Td><Table.Td /></Table.Tr>
      </Table.Tbody>
    </Table>
  );
}

/** Impuestos → Ingresos por provincia (spec E38 §7): la parte de ingresos del CM05. */
export function IngresosProvinciaPage() {
  const [anio, setAnio] = useState(new Date().getFullYear() - 1);
  const q = useQuery({ queryKey: ['/impuestos/iibb/ingresos-por-provincia', anio], queryFn: () => api<IngresosProvincia>('/impuestos/iibb/ingresos-por-provincia', { query: { anio: String(anio) } }) });
  const archivo = (formato: 'xlsx' | 'pdf') => void descargar('/impuestos/iibb/ingresos-por-provincia', { anio: String(anio), formato }, `ingresos-por-provincia-${anio}.${formato}`);
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Ingresos por provincia</Title>
        <Group gap="xs">
          <Select aria-label="Año" w={100} data={[anio - 1, anio, anio + 1].map(String)} value={String(anio)} onChange={(x) => setAnio(Number(x))} />
          <Button size="xs" variant="default" onClick={() => archivo('xlsx')}>Excel</Button>
          <Button size="xs" variant="default" onClick={() => archivo('pdf')}>PDF</Button>
        </Group>
      </Group>
      {errorConsulta(q.error)}
      {q.data?.avisos.map((a) => <Alert key={a} color="yellow" mb="xs">{a}</Alert>)}
      {q.data && <TablaIngresosProvincia r={q.data} />}
      <Text size="xs" c="dimmed" mt="xs">Ingresos gravados del año por la provincia del cliente: la parte de ingresos del CM05. Los gastos los atribuye el contador.</Text>
    </Paper>
  );
}
