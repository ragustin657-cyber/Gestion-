import { Alert, Badge, Button, Group, Paper, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import { formatoMoneda, hoy } from '../compras/formato';
import { useOperacion } from '../tesoreria/comun';

export interface PreviaAmortizacion { mes: string; filas: { bienId: string; numero: number; descripcion: string; rubro: string; importe: string }[]; porRubro: { rubroId: string; nombre: string; importe: string }[]; total: string }
interface Proceso { id: string; mes: string; estado: 'VIGENTE' | 'ANULADO'; total: string; numeroAsiento: number; creadoEn: string }
const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export function VistaPreviaAmortizacion({ datos, onGenerar, enviando = false }: { datos: PreviaAmortizacion; onGenerar: () => void; enviando?: boolean }) {
  const vacia = Number(datos.total) === 0;
  return <>
    {vacia && <Alert color="blue" mb="sm">{`No hay amortizaciones para contabilizar en ${mmaaaa(datos.mes)}.`}</Alert>}
    <Table withTableBorder striped mb="sm">
      <Table.Thead><Table.Tr><Table.Th>Rubro</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{datos.porRubro.map((r) => <Table.Tr key={r.rubroId}><Table.Td>{r.nombre}</Table.Td><Table.Td ta="right">{formatoMoneda(r.importe)}</Table.Td></Table.Tr>)}</Table.Tbody>
      <Table.Tfoot><Table.Tr><Table.Th>Total</Table.Th><Table.Th ta="right">{formatoMoneda(datos.total)}</Table.Th></Table.Tr></Table.Tfoot>
    </Table>
    {datos.filas.length > 0 && <Table withTableBorder mb="sm" fz="sm">
      <Table.Thead><Table.Tr><Table.Th>N°</Table.Th><Table.Th>Bien</Table.Th><Table.Th>Rubro</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{datos.filas.map((f) => <Table.Tr key={f.bienId}><Table.Td>{f.numero}</Table.Td><Table.Td>{f.descripcion}</Table.Td><Table.Td>{f.rubro}</Table.Td><Table.Td ta="right">{formatoMoneda(f.importe)}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table>}
    <Button disabled={vacia} loading={enviando} onClick={onGenerar}>Generar</Button>
  </>;
}

export function AmortizacionPage() {
  const qc = useQueryClient();
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [previa, setPrevia] = useState<PreviaAmortizacion | null>(null);
  const op = useOperacion();
  const lista = useQuery({ queryKey: ['/bienes-uso/amortizacion'], queryFn: () => api<Proceso[]>('/bienes-uso/amortizacion') });
  const refrescar = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/bienes-uso') });
  const ver = async () => {
    op.setError('');
    try {
      setPrevia(await api<PreviaAmortizacion>('/bienes-uso/amortizacion/previa', { query: { mes } }));
    } catch (e) {
      setPrevia(null);
      op.setError(e instanceof ErrorApi ? e.mensaje : 'Error inesperado');
    }
  };
  const generar = async () => {
    const r = await op.ejecutar(() => api<{ numeroAsiento: number }>('/bienes-uso/amortizacion', { metodo: 'POST', body: { mes } }), (x) => `Amortización generada: asiento N° ${x.numeroAsiento}`);
    if (r) { setPrevia(null); refrescar(); }
  };
  const anular = async (id: string) => {
    if (await op.ejecutar(() => api(`/bienes-uso/amortizacion/${id}/anular`, { metodo: 'POST' }), () => 'Amortización anulada')) refrescar();
  };
  const ultimaVigente = lista.data?.find((p) => p.estado === 'VIGENTE');
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Amortización del mes</Title>
      <Group align="flex-end" mb="md">
        <TextInput label="Mes" type="month" w={180} value={mes} onChange={(e) => { setMes(e.currentTarget.value); setPrevia(null); }} />
        <Button variant="default" onClick={() => void ver()}>Ver previa</Button>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">Calcula lo que cada bien debería tener amortizado hasta el mes y contabiliza la diferencia (lineal, desde el mes de alta).</Text>
      {op.alerta}
      {previa && <VistaPreviaAmortizacion datos={previa} onGenerar={() => void generar()} enviando={op.enviando} />}
      <Title order={5} mt="lg" mb="xs">Amortizaciones generadas</Title>
      <Table withTableBorder striped>
        <Table.Thead><Table.Tr><Table.Th>Mes</Table.Th><Table.Th>Asiento</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(lista.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{mmaaaa(p.mes)}</Table.Td><Table.Td>{p.numeroAsiento}</Table.Td><Table.Td ta="right">{formatoMoneda(p.total)}</Table.Td>
              <Table.Td><Badge variant="light" color={p.estado === 'VIGENTE' ? 'green' : 'gray'}>{p.estado === 'VIGENTE' ? 'Vigente' : 'Anulada'}</Badge></Table.Td>
              <Table.Td>{ultimaVigente?.id === p.id && <Button size="xs" color="red" variant="subtle" onClick={() => void anular(p.id)}>Anular</Button>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
