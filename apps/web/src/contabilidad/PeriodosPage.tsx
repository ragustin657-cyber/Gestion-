import { Alert, Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';
import { Ejercicio, useEjercicios } from './comun';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
interface Previa { resultado: string; refundicion: { cuenta: string; debe: string; haber: string }[]; cierre: { cuenta: string; debe: string; haber: string }[]; faltantes: string[] }

function CierreEjercicio({ ejercicio, alTerminar }: { ejercicio: Ejercicio; alTerminar: () => void }) {
  const q = useQuery({ queryKey: ['/contabilidad/ejercicios', ejercicio.id, 'previa'], queryFn: () => api<Previa>(`/contabilidad/ejercicios/${ejercicio.id}/cierre/previa`) });
  const op = useOperacion();
  if (!q.data) return errorConsulta(q.error) ?? <Text c="dimmed">Calculando…</Text>;
  const p = q.data;
  return (
    <Stack>
      <Text>Resultado del ejercicio: <b>{formatoMoneda(p.resultado)}</b></Text>
      {p.faltantes.map((f) => <Alert key={f} color="yellow">{f}</Alert>)}
      <Text fw={600}>Refundición</Text>
      <Table withTableBorder><Table.Tbody>{p.refundicion.map((r, i) => <Table.Tr key={i}><Table.Td>{r.cuenta}</Table.Td><Table.Td ta="right">{r.debe !== '0' ? formatoMoneda(r.debe) : ''}</Table.Td><Table.Td ta="right">{r.haber !== '0' ? formatoMoneda(r.haber) : ''}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <Text size="sm" c="dimmed">Después se generan el asiento de cierre ({p.cierre.length} cuentas patrimoniales) y la apertura del ejercicio siguiente.</Text>
      <Group justify="flex-end">
        <Button color="red" disabled={!!p.faltantes.length} loading={op.enviando} onClick={async () => {
          if (await op.ejecutar(() => api(`/contabilidad/ejercicios/${ejercicio.id}/cerrar`, { metodo: 'POST' }), () => `Ejercicio ${ejercicio.numero} cerrado`)) alTerminar();
        }}>Cerrar ejercicio</Button>
      </Group>
      {op.alerta}
    </Stack>
  );
}

export function PeriodosPage() {
  const { puede } = useAuth();
  const q = useEjercicios();
  const op = useOperacion();
  const [cerrando, setCerrando] = useState<Ejercicio | null>(null);
  const [reabriendo, setReabriendo] = useState<{ ruta: string; titulo: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const puedeCerrar = puede('contabilidad.cerrar');
  const refrescar = () => void q.refetch();
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <Title order={3}>Períodos y ejercicios</Title>
          {puedeCerrar && <Button variant="light" onClick={async () => { if (await op.ejecutar(() => api<{ numero: number }>('/contabilidad/ejercicios/siguiente', { metodo: 'POST' }), (e) => `Ejercicio ${e.numero} abierto`)) refrescar(); }}>Abrir ejercicio siguiente</Button>}
        </Group>
        {op.alerta}
        {errorConsulta(q.error)}
      </Paper>
      {(q.data ?? []).map((e) => {
        const ultimoCerrado = [...e.periodos].reverse().find((p) => p.estado === 'CERRADO');
        const proximo = e.periodos.find((p) => p.estado === 'ABIERTO');
        return (
          <Paper key={e.id} withBorder p="md" radius="md">
            <Group justify="space-between" mb="sm">
              <Group><Title order={4}>Ejercicio {e.numero}</Title><Text c="dimmed">{formatoFecha(e.desde)} al {formatoFecha(e.hasta)}</Text>
                <Badge color={e.estado === 'ABIERTO' ? 'blue' : 'green'} variant="light">{e.estado === 'ABIERTO' ? 'Abierto' : 'Cerrado'}</Badge></Group>
              {puedeCerrar && (
                <Group gap="xs">
                  {e.estado === 'ABIERTO' && proximo && proximo !== e.periodos[11] && (
                    <Button size="xs" onClick={async () => { if (await op.ejecutar(() => api(`/contabilidad/periodos/${proximo.id}/cerrar`, { metodo: 'POST' }), () => `Período ${proximo.mes}/${proximo.anio} cerrado`)) refrescar(); }}>
                      Cerrar {MESES[proximo.mes - 1]} {proximo.anio}
                    </Button>
                  )}
                  {e.estado === 'ABIERTO' && ultimoCerrado && <Button size="xs" variant="default" onClick={() => { setMotivo(''); setReabriendo({ ruta: `/contabilidad/periodos/${ultimoCerrado.id}/reabrir`, titulo: `Reabrir ${MESES[ultimoCerrado.mes - 1]} ${ultimoCerrado.anio}` }); }}>Reabrir {MESES[ultimoCerrado.mes - 1]} {ultimoCerrado.anio}</Button>}
                  {e.estado === 'ABIERTO' && <Button size="xs" color="red" variant="light" onClick={() => setCerrando(e)}>Cerrar ejercicio</Button>}
                  {e.estado === 'CERRADO' && <Button size="xs" color="orange" variant="light" onClick={() => { setMotivo(''); setReabriendo({ ruta: `/contabilidad/ejercicios/${e.id}/reabrir`, titulo: `Reabrir el ejercicio ${e.numero}` }); }}>Reabrir ejercicio</Button>}
                </Group>
              )}
            </Group>
            <SimpleGrid cols={{ base: 3, sm: 6, lg: 12 }} spacing="xs">
              {e.periodos.map((p) => (
                <Paper key={p.id} withBorder p={6} radius="sm" bg={p.estado === 'CERRADO' ? 'green.0' : undefined} data-testid={`periodo-${p.anio}-${p.mes}`}>
                  <Text size="xs" fw={700}>{MESES[p.mes - 1]} {p.anio}</Text>
                  <Text size="xs" c={p.estado === 'CERRADO' ? 'green' : 'dimmed'}>{p.estado === 'CERRADO' ? 'Cerrado' : 'Abierto'}</Text>
                  <Text size="xs" c="dimmed">{p.asientos} asientos</Text>
                </Paper>
              ))}
            </SimpleGrid>
          </Paper>
        );
      })}
      <Modal opened={!!cerrando} onClose={() => setCerrando(null)} title={`Cierre del ejercicio ${cerrando?.numero ?? ''}`} size="lg">
        {cerrando && <CierreEjercicio ejercicio={cerrando} alTerminar={() => { setCerrando(null); refrescar(); }} />}
      </Modal>
      <Modal opened={!!reabriendo} onClose={() => setReabriendo(null)} title={reabriendo?.titulo}>
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button color="orange" disabled={!motivo.trim()} onClick={async () => { if (await op.ejecutar(() => api(reabriendo!.ruta, { metodo: 'POST', body: { motivo } }), () => 'Reabierto')) { setReabriendo(null); refrescar(); } }}>Reabrir</Button>
        </Group>
        {op.alerta}
      </Modal>
    </Stack>
  );
}
