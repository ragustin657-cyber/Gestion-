import { Badge, Button, Checkbox, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Timeline, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { Cheque, errorConsulta, ESTADOS_CHEQUE, estadoCheque, numero, useCheques, useOperacion } from './comun';

interface Historial { id: string; fecha: string; estadoAnterior: string | null; estadoNuevo: string; caja: string | null; cuentaBancaria: string | null; usuario: string | null; origenTipo: string }
interface ChequePropio {
  id: string; numero: string; fechaEmision: string; fechaPago: string; monedaCodigo: string; importe: string; estado: string; diferido: boolean; fechaDebito: string | null;
  cuentaBancaria: { numero: string; banco: string }; beneficiario: { razonSocial: string } | null; ordenPagoNumero: number | null;
}

function TablaCheques({ cheques, onSeleccionar }: { cheques: Cheque[]; onSeleccionar?: (c: Cheque) => void }) {
  return (
    <ScrollArea>
      <Table withTableBorder striped highlightOnHover={!!onSeleccionar} miw={900}>
        <Table.Thead>
          <Table.Tr><Table.Th>Banco</Table.Th><Table.Th>Número</Table.Th><Table.Th>Librador</Table.Th><Table.Th>Fecha de pago</Table.Th><Table.Th>Ubicación</Table.Th><Table.Th>Recibido de</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Estado</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {cheques.map((c) => (
            <Table.Tr key={c.id} style={onSeleccionar ? { cursor: 'pointer' } : undefined} onClick={() => onSeleccionar?.(c)}>
              <Table.Td>{c.banco}</Table.Td><Table.Td>{c.numero}</Table.Td><Table.Td>{c.libradorNombre}</Table.Td><Table.Td>{formatoFecha(c.fechaPago)}</Table.Td>
              <Table.Td>{c.caja ? `${c.caja.nombre} (${c.caja.sucursal})` : c.cuentaBancaria ? `${c.cuentaBancaria.banco} - ${c.cuentaBancaria.numero}` : c.terceroDestino?.razonSocial ?? '—'}</Table.Td>
              <Table.Td>{c.terceroOrigen?.razonSocial ?? '—'}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(c.importe, c.monedaCodigo)}</Table.Td><Table.Td>{estadoCheque(c.estado)}</Table.Td>
            </Table.Tr>
          ))}
          {!cheques.length && <Table.Tr><Table.Td colSpan={8}><Text c="dimmed" size="sm" ta="center">Sin cheques</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function HistorialCheque({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['/tesoreria/cheques', id], queryFn: () => api<Cheque & { historial: Historial[] }>(`/tesoreria/cheques/${id}`) });
  if (!q.data) return errorConsulta(q.error);
  const c = q.data;
  return (
    <Stack>
      <Text fw={700}>Cheque {c.numero} · {c.banco} · {formatoMoneda(c.importe, c.monedaCodigo)}</Text>
      <Text size="sm">Librador: {c.libradorNombre} · Pago: {formatoFecha(c.fechaPago)} · {estadoCheque(c.estado)}</Text>
      <Timeline active={c.historial.length - 1} bulletSize={16} lineWidth={2} data-testid="historial-cheque">
        {c.historial.map((h) => (
          <Timeline.Item key={h.id} title={ESTADOS_CHEQUE[h.estadoNuevo]?.etiqueta ?? h.estadoNuevo}>
            <Text size="xs" c="dimmed">{formatoFecha(h.fecha)} · {h.usuario ?? ''}{h.caja ? ` · ${h.caja}` : ''}{h.cuentaBancaria ? ` · ${h.cuentaBancaria}` : ''}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Stack>
  );
}

export function CarteraPage() {
  const [estado, setEstado] = useState<string | null>('EN_CARTERA');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [librador, setLibrador] = useState('');
  const [elegido, setElegido] = useState<Cheque | null>(null);
  const q = useCheques({ estado: estado ?? undefined, desde: desde || undefined, hasta: hasta || undefined, librador: librador || undefined });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Cartera de cheques</Title>
      <Group align="flex-end" wrap="wrap" mb="md">
        <Select label="Estado" clearable w={180} value={estado} onChange={setEstado} data={Object.entries(ESTADOS_CHEQUE).map(([value, e]) => ({ value, label: e.etiqueta }))} />
        <TextInput label="Pago desde" type="date" value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Pago hasta" type="date" value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <TextInput label="Librador" value={librador} onChange={(e) => setLibrador(e.currentTarget.value)} />
      </Group>
      {errorConsulta(q.error)}
      <TablaCheques cheques={q.data?.items ?? []} onSeleccionar={setElegido} />
      <Group justify="space-between" mt="sm" align="flex-start">
        <Stack gap={0}>
          {(q.data?.porSemana ?? []).map((s) => <Text key={`${s.semana}${s.monedaCodigo}`} size="xs">Semana del {formatoFecha(s.semana)}: {formatoMoneda(s.importe, s.monedaCodigo)}</Text>)}
        </Stack>
        <Stack gap={0} align="flex-end">
          {(q.data?.totales ?? []).map((t) => <Text key={t.monedaCodigo} fw={700}>Total {formatoMoneda(t.importe, t.monedaCodigo)}</Text>)}
        </Stack>
      </Group>
      <Modal opened={!!elegido} onClose={() => setElegido(null)} title="Historial del cheque" size="lg">{elegido && <HistorialCheque id={elegido.id} />}</Modal>
    </Paper>
  );
}

export function RechazoChequesPage() {
  const q = useCheques({ estado: 'DEPOSITADO,ACREDITADO,ENDOSADO' });
  const rechazados = useCheques({ estado: 'RECHAZADO' });
  const [elegido, setElegido] = useState<Cheque | null>(null);
  const [devolviendo, setDevolviendo] = useState<Cheque | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [gastos, setGastos] = useState('');
  const op = useOperacion();
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Rechazo de cheques</Title>
        <Text size="sm" c="dimmed" mb="sm">Elija el cheque rechazado (depositado, acreditado o endosado a un proveedor).</Text>
        {errorConsulta(q.error)}
        <TablaCheques cheques={q.data?.items ?? []} onSeleccionar={setElegido} />
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">Cheques rechazados</Title>
        <TablaCheques cheques={rechazados.data?.items ?? []} onSeleccionar={setDevolviendo} />
      </Paper>
      <Modal opened={!!elegido} onClose={() => setElegido(null)} title={`Rechazar cheque ${elegido?.numero ?? ''}`}>
        <Stack>
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          {elegido?.estado !== 'ENDOSADO' && <TextInput label="Gastos bancarios" inputMode="decimal" value={gastos} onChange={(e) => setGastos(e.currentTarget.value)} />}
          <Group justify="flex-end">
            <Button color="red" loading={op.enviando} disabled={!motivo.trim()} onClick={async () => {
              const r = await op.ejecutar(() => api(`/tesoreria/cheques/${elegido!.id}/rechazar`, { metodo: 'POST', body: { fecha, motivo, gastos: gastos ? numero(gastos) : null } }), () => 'Cheque rechazado');
              if (r) { setElegido(null); setMotivo(''); setGastos(''); }
            }}>Rechazar</Button>
          </Group>
          {op.alerta}
        </Stack>
      </Modal>
      <Modal opened={!!devolviendo} onClose={() => setDevolviendo(null)} title={`Devolver cheque ${devolviendo?.numero ?? ''}`}>
        <Stack>
          <Text size="sm">El cheque físico se entrega a quien lo dio. No genera asiento.</Text>
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button loading={op.enviando} onClick={async () => {
              if (await op.ejecutar(() => api(`/tesoreria/cheques/${devolviendo!.id}/devolver`, { metodo: 'POST', body: { fecha } }), () => 'Cheque devuelto')) setDevolviendo(null);
            }}>Devolver</Button>
          </Group>
          {op.alerta}
        </Stack>
      </Modal>
    </Stack>
  );
}

const useChequesPropios = (estado?: string) =>
  useQuery({ queryKey: ['/tesoreria/cheques-propios', estado], queryFn: () => api<{ items: ChequePropio[] }>('/tesoreria/cheques-propios', { query: { estado, porPagina: 200 } }) });

function TablaChequesPropios({ cheques, seleccion, onChange }: { cheques: ChequePropio[]; seleccion?: string[]; onChange?: (s: string[]) => void }) {
  return (
    <ScrollArea>
      <Table withTableBorder striped miw={800}>
        <Table.Thead><Table.Tr>{onChange && <Table.Th w={36} />}<Table.Th>Número</Table.Th><Table.Th>Cuenta</Table.Th><Table.Th>Beneficiario</Table.Th><Table.Th>Emisión</Table.Th><Table.Th>Pago</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {cheques.map((c) => (
            <Table.Tr key={c.id}>
              {onChange && <Table.Td><Checkbox aria-label={`Cheque propio ${c.numero}`} checked={seleccion!.includes(c.id)} onChange={() => onChange(seleccion!.includes(c.id) ? seleccion!.filter((x) => x !== c.id) : [...seleccion!, c.id])} /></Table.Td>}
              <Table.Td>{c.numero}</Table.Td><Table.Td>{c.cuentaBancaria.banco} - {c.cuentaBancaria.numero}</Table.Td><Table.Td>{c.beneficiario?.razonSocial ?? ''}</Table.Td>
              <Table.Td>{formatoFecha(c.fechaEmision)}</Table.Td><Table.Td>{formatoFecha(c.fechaPago)}</Table.Td><Table.Td>{c.diferido ? 'Diferido' : 'Al día'}</Table.Td>
              <Table.Td ta="right">{formatoMoneda(c.importe, c.monedaCodigo)}</Table.Td>
              <Table.Td><Badge size="sm" variant="light" color={c.estado === 'DEBITADO' ? 'green' : c.estado === 'ANULADO' ? 'gray' : 'blue'}>{c.estado === 'EMITIDO' ? 'Emitido' : c.estado === 'DEBITADO' ? 'Debitado' : 'Anulado'}</Badge></Table.Td>
            </Table.Tr>
          ))}
          {!cheques.length && <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm" ta="center">Sin cheques</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

export function DebitoChequesPropiosPage() {
  const q = useChequesPropios('EMITIDO');
  const [fecha, setFecha] = useState(hoy());
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const op = useOperacion();
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Débito de cheques propios</Title>
      <TextInput label="Fecha de débito" type="date" w={200} mb="md" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      {errorConsulta(q.error)}
      <TablaChequesPropios cheques={q.data?.items ?? []} seleccion={seleccion} onChange={setSeleccion} />
      <Group justify="flex-end" mt="md">
        <Button loading={op.enviando} disabled={!seleccion.length} onClick={async () => {
          if (await op.ejecutar(() => api<{ debitados: number }>('/tesoreria/cheques-propios/debitar', { metodo: 'POST', body: { fecha, cheques: seleccion } }), (r) => `${r.debitados} cheques debitados`)) setSeleccion([]);
        }}>Debitar</Button>
      </Group>
      {op.alerta}
    </Paper>
  );
}

export function ChequesPropiosPage() {
  const [estado, setEstado] = useState<string | null>('EMITIDO');
  const q = useChequesPropios(estado ?? undefined);
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={3} mb="md">Cheques propios</Title>
      <Select label="Estado" clearable w={180} mb="md" value={estado} onChange={setEstado} data={[{ value: 'EMITIDO', label: 'Emitidos' }, { value: 'DEBITADO', label: 'Debitados' }, { value: 'ANULADO', label: 'Anulados' }]} />
      {errorConsulta(q.error)}
      <TablaChequesPropios cheques={q.data?.items ?? []} />
    </Paper>
  );
}

