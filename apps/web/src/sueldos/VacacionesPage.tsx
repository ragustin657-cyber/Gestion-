import { Alert, Button, Checkbox, Group, Modal, NumberInput, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, hoy } from '../compras/formato';
import { errorConsulta, useOperacion } from '../tesoreria/comun';

export interface PeriodoVacaciones { id: string; empleadoId: string; anio: number; desde: string; hasta: string; dias: number; liquidadoAfuera: boolean; liquidado: boolean }
export interface FilaSaldoVacaciones { empleadoId: string; legajo: number; nombre: string; corresponden: number; saldoInicial: number | null; tomados: number; pendientes: number; periodos: PeriodoVacaciones[] }
export interface DatosPeriodo { empleadoId: string; anio: number; desde: string; hasta: string; liquidadoAfuera: boolean }

const diasEntre = (desde: string, hasta: string) => (desde && hasta && hasta >= desde ? Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1 : 0);

/** Saldo de vacaciones del año por empleado (pendientes negativos en rojo). */
export function TablaSaldosVacaciones({ filas, onElegir }: { filas: FilaSaldoVacaciones[]; onElegir: (f: FilaSaldoVacaciones) => void }) {
  return (
    <Table withTableBorder striped highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>Legajo</Table.Th><Table.Th>Empleado</Table.Th><Table.Th ta="right">Corresponden</Table.Th><Table.Th ta="right">Tomados</Table.Th><Table.Th ta="right">Pendientes</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {filas.map((f) => (
          <Table.Tr key={f.empleadoId} style={{ cursor: 'pointer' }} onClick={() => onElegir(f)}>
            <Table.Td>{f.legajo}</Table.Td><Table.Td>{f.nombre}</Table.Td>
            <Table.Td ta="right">{f.corresponden}{f.saldoInicial !== null ? ' (saldo inicial)' : ''}</Table.Td>
            <Table.Td ta="right">{f.tomados}</Table.Td>
            <Table.Td ta="right" data-negativo={String(f.pendientes < 0)} c={f.pendientes < 0 ? 'red' : undefined} fw={f.pendientes < 0 ? 700 : undefined}>{f.pendientes}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Alta o edición de un período de vacaciones (días corridos). */
export function DialogoPeriodo({ empleado, anio, inicial, avisos, onGuardar, enviando }: {
  empleado: { id: string; nombre: string }; anio: number; inicial?: Partial<DatosPeriodo>; avisos?: string[]; onGuardar: (d: DatosPeriodo) => void; enviando?: boolean;
}) {
  const [d, setD] = useState<DatosPeriodo>({ empleadoId: empleado.id, anio, desde: '', hasta: '', liquidadoAfuera: false, ...inicial });
  const dias = diasEntre(d.desde, d.hasta);
  return (
    <Stack>
      <Text size="sm">{empleado.nombre}</Text>
      <Group grow>
        <TextInput type="date" label="Desde" value={d.desde} onChange={(e) => setD({ ...d, desde: e.currentTarget.value })} />
        <TextInput type="date" label="Hasta" value={d.hasta} onChange={(e) => setD({ ...d, hasta: e.currentTarget.value })} />
        <NumberInput label="Vacaciones del año" value={d.anio} onChange={(v) => setD({ ...d, anio: Number(v) || anio })} />
      </Group>
      <Text fw={600}>{dias} días</Text>
      <Checkbox label="Liquidado fuera del sistema (no se paga en la mensual)" checked={d.liquidadoAfuera} onChange={(e) => setD({ ...d, liquidadoAfuera: e.currentTarget.checked })} />
      {avisos?.map((a) => <Alert key={a} color="yellow">{a}</Alert>)}
      <Group justify="flex-end"><Button onClick={() => onGuardar(d)} disabled={!dias} loading={enviando}>Guardar</Button></Group>
    </Stack>
  );
}

/** Tras guardar: con avisos, el diálogo queda editando el período guardado (un nuevo guardado no crea otro); sin avisos, se cierra. */
export function siguienteEstadoPeriodo(_actual: { id?: string }, r: { id: string; avisos: string[] }, d: Omit<DatosPeriodo, 'empleadoId'> & { empleadoId?: string }) {
  if (!r.avisos.length) return null;
  const { empleadoId: _e, ...inicial } = d;
  return { id: r.id, inicial };
}

export function VacacionesPage() {
  const { puede } = useAuth();
  const qc = useQueryClient();
  const op = useOperacion();
  const editable = puede('sueldos.liquidar');
  const [anio, setAnio] = useState(Number(hoy().slice(0, 4)));
  const q = useQuery({ queryKey: ['/sueldos/vacaciones', anio], queryFn: () => api<FilaSaldoVacaciones[]>('/sueldos/vacaciones', { query: { anio } }) });
  const [elegido, setElegido] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<{ id?: string; inicial?: Partial<DatosPeriodo> } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const fila = q.data?.find((f) => f.empleadoId === elegido) ?? null;
  const refrescar = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/sueldos') });
  const guardar = async (d: DatosPeriodo) => {
    const r = await op.ejecutar(() => api<{ id: string; avisos: string[] }>(periodo?.id ? `/sueldos/vacaciones/${periodo.id}` : '/sueldos/vacaciones', { metodo: periodo?.id ? 'PUT' : 'POST', body: d }), () => 'Período guardado');
    if (r) { refrescar(); setAvisos(r.avisos); setPeriodo(siguienteEstadoPeriodo(periodo ?? {}, r, d)); }
  };
  const [saldoInicial, setSaldoInicial] = useState<number | ''>('');
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Vacaciones</Title>
        <NumberInput aria-label="Año" value={anio} onChange={(v) => setAnio(Number(v) || anio)} w={110} />
      </Group>
      {errorConsulta(q.error)}
      <TablaSaldosVacaciones filas={q.data ?? []} onElegir={(f) => { setElegido(f.empleadoId); setSaldoInicial(f.saldoInicial ?? ''); }} />
      <Modal opened={!!fila && !periodo} onClose={() => setElegido(null)} size="lg" title={fila ? `${fila.nombre} · vacaciones ${anio}` : ''}>
        {fila && (
          <Stack>
            <Text size="sm">Corresponden {fila.corresponden} · tomados {fila.tomados} · pendientes {fila.pendientes}</Text>
            {editable && (
              <Group align="flex-end">
                <NumberInput label="Saldo inicial (reemplaza lo que corresponde)" w={260} min={0} value={saldoInicial} onChange={(v) => setSaldoInicial(v === '' ? '' : Number(v))} />
                <Button variant="light" onClick={async () => { if (await op.ejecutar(() => api('/sueldos/vacaciones/saldo-inicial', { metodo: 'PUT', body: { empleadoId: fila.empleadoId, anio, dias: saldoInicial === '' ? null : saldoInicial } }), () => 'Saldo guardado')) refrescar(); }}>Guardar saldo</Button>
              </Group>
            )}
            <Table withTableBorder>
              <Table.Thead><Table.Tr><Table.Th>Desde</Table.Th><Table.Th>Hasta</Table.Th><Table.Th ta="right">Días</Table.Th><Table.Th>Estado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {fila.periodos.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{formatoFecha(p.desde)}</Table.Td><Table.Td>{formatoFecha(p.hasta)}</Table.Td><Table.Td ta="right">{p.dias}</Table.Td>
                    <Table.Td>{p.liquidado ? 'Pagado' : p.liquidadoAfuera ? 'Liquidado fuera del sistema' : 'Pendiente de pago'}</Table.Td>
                    <Table.Td>{editable && !p.liquidado && (
                      <Group gap={4}>
                        <Button size="compact-xs" variant="subtle" onClick={() => { setAvisos([]); setPeriodo({ id: p.id, inicial: { anio: p.anio, desde: p.desde, hasta: p.hasta, liquidadoAfuera: p.liquidadoAfuera } }); }}>Editar</Button>
                        <Button size="compact-xs" variant="subtle" color="red" disabled={op.enviando} onClick={async () => { if (await op.ejecutar(() => api(`/sueldos/vacaciones/${p.id}`, { metodo: 'DELETE' }), () => 'Período eliminado')) refrescar(); }}>Eliminar</Button>
                      </Group>
                    )}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {op.alerta}
            {editable && <Group justify="flex-end"><Button onClick={() => { setAvisos([]); setPeriodo({}); }}>Nuevo período</Button></Group>}
          </Stack>
        )}
      </Modal>
      <Modal opened={!!periodo && !!fila} onClose={() => setPeriodo(null)} title={periodo?.id ? 'Editar período' : 'Nuevo período'}>
        {periodo && fila && (
          <>
            <DialogoPeriodo empleado={{ id: fila.empleadoId, nombre: fila.nombre }} anio={anio} inicial={periodo.inicial} avisos={avisos} onGuardar={guardar} enviando={op.enviando} />
            {op.alerta}
            {avisos.length > 0 && <Text size="xs" c="dimmed" mt="xs">El período se guardó con avisos. Cierre esta ventana para continuar.</Text>}
          </>
        )}
      </Modal>
    </Paper>
  );
}
