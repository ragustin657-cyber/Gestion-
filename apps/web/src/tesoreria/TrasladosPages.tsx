import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useAuth } from '../auth/AuthContext';
import { formatoFecha, formatoMoneda, hoy } from '../compras/formato';
import { errorConsulta, numero, opcionesCajas, useCajas, useCajasDestino, useCheques, useOperacion } from './comun';
import { SelectorCheques } from './SelectorCheques';

interface ItemTraslado { id: string; tipo: 'CHEQUE' | 'EFECTIVO'; monedaCodigo: string; importe: string; aceptado: boolean | null; motivoRechazo: string | null; cheque: { banco: string; numero: string; libradorNombre: string } | null }
interface Traslado {
  id: string; numero: number; fecha: string; estado: string; observaciones: string | null;
  cajaOrigen: { id: string; nombre: string; sucursal: string }; cajaDestino: { id: string; nombre: string; sucursal: string }; items: ItemTraslado[];
}

const ESTADOS: Record<string, { etiqueta: string; color: string }> = {
  ENVIADO: { etiqueta: 'En tránsito', color: 'yellow' }, RECIBIDO: { etiqueta: 'Recibido', color: 'green' },
  RECIBIDO_PARCIAL: { etiqueta: 'Recibido parcial', color: 'orange' }, ANULADO: { etiqueta: 'Anulado', color: 'gray' },
};
const descripcion = (i: ItemTraslado) => (i.cheque ? `Cheque ${i.cheque.numero} ${i.cheque.banco} (${i.cheque.libradorNombre})` : 'Efectivo');
const total = (t: Traslado) => t.items.reduce((s, i) => s + Number(i.importe), 0);

function TablaTraslados({ estado, onSeleccionar, titulo }: { estado?: string; onSeleccionar?: (t: Traslado) => void; titulo: string }) {
  const q = useQuery({ queryKey: ['/tesoreria/traslados', estado], queryFn: () => api<{ items: Traslado[] }>('/tesoreria/traslados', { query: { estado, porPagina: 100 } }) });
  return (
    <Paper withBorder p="md" radius="md">
      <Title order={4} mb="sm">{titulo}</Title>
      {errorConsulta(q.error)}
      <ScrollArea>
        <Table withTableBorder striped highlightOnHover={!!onSeleccionar} miw={760}>
          <Table.Thead><Table.Tr><Table.Th>Número</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Origen</Table.Th><Table.Th>Destino</Table.Th><Table.Th>Valores</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(q.data?.items ?? []).map((t) => (
              <Table.Tr key={t.id} style={onSeleccionar ? { cursor: 'pointer' } : undefined} onClick={() => onSeleccionar?.(t)}>
                <Table.Td>{t.numero}</Table.Td><Table.Td>{formatoFecha(t.fecha)}</Table.Td>
                <Table.Td>{t.cajaOrigen.nombre} ({t.cajaOrigen.sucursal})</Table.Td><Table.Td>{t.cajaDestino.nombre} ({t.cajaDestino.sucursal})</Table.Td>
                <Table.Td>{t.items.map(descripcion).join(', ')}</Table.Td><Table.Td ta="right">{formatoMoneda(total(t))}</Table.Td>
                <Table.Td><Badge size="sm" variant="light" color={ESTADOS[t.estado]?.color}>{ESTADOS[t.estado]?.etiqueta}</Badge></Table.Td>
              </Table.Tr>
            ))}
            {!q.data?.items.length && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm" ta="center">Sin traslados</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

export function TrasladoPage() {
  const { puede } = useAuth();
  const cajas = useCajas();
  const destinos = useCajasDestino();
  const [fecha, setFecha] = useState(hoy());
  const [origen, setOrigen] = useState<string | null>(null);
  const [destino, setDestino] = useState<string | null>(null);
  const [efectivo, setEfectivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [anulando, setAnulando] = useState<Traslado | null>(null);
  const [motivo, setMotivo] = useState('');
  const cheques = useCheques({ estado: 'EN_CARTERA', cajaId: origen ?? undefined }, !!origen);
  const op = useOperacion();
  const monedaOrigen = cajas.find((c) => c.id === origen)?.monedaCodigo;

  async function enviar() {
    const r = await op.ejecutar(() => api<Traslado>('/tesoreria/traslados', {
      metodo: 'POST', body: { fecha, cajaOrigenId: origen, cajaDestinoId: destino, cheques: seleccion, efectivo: efectivo ? { importe: numero(efectivo) } : null, observaciones: observaciones || null },
    }), (t) => `Traslado ${t.numero} enviado`);
    if (r) {
      setSeleccion([]);
      setEfectivo('');
    }
  }
  return (
    <Stack>
      <Paper withBorder p="md" radius="md">
        <Title order={3} mb="md">Traslado de valores</Title>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
          <Select label="Caja de origen" w={300} data={opcionesCajas(cajas)} value={origen} onChange={(v) => { setOrigen(v); setSeleccion([]); }} />
          <Select label="Caja de destino" w={300} searchable value={destino} onChange={setDestino}
            data={destinos.filter((c) => c.id !== origen && (!monedaOrigen || c.monedaCodigo === monedaOrigen)).map((c) => ({ value: c.id, label: `${c.nombre} (${c.sucursal})` }))} />
          <TextInput label="Efectivo" w={160} inputMode="decimal" value={efectivo} onChange={(e) => setEfectivo(e.currentTarget.value)} />
          <TextInput label="Observaciones" w={260} value={observaciones} onChange={(e) => setObservaciones(e.currentTarget.value)} />
        </Group>
        {origen && <><Text fw={600} mt="md" mb={4}>Cheques en la caja de origen</Text><SelectorCheques cheques={cheques.data?.items ?? []} seleccion={seleccion} onChange={setSeleccion} /></>}
        <Group justify="flex-end" mt="md"><Button loading={op.enviando} disabled={!origen || !destino || (!seleccion.length && !efectivo)} onClick={enviar}>Enviar</Button></Group>
        {op.alerta}
      </Paper>
      <TablaTraslados titulo="Traslados enviados pendientes de recepción" estado="ENVIADO" onSeleccionar={puede('tesoreria.anular') ? setAnulando : undefined} />
      <Modal opened={!!anulando} onClose={() => setAnulando(null)} title={`Anular traslado ${anulando?.numero ?? ''}`}>
        <Text size="sm" mb="sm">Los valores vuelven a la caja de origen.</Text>
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button color="red" disabled={!motivo.trim()} onClick={async () => {
            if (await op.ejecutar(() => api(`/tesoreria/traslados/${anulando!.id}/anular`, { metodo: 'POST', body: { motivo } }), () => 'Traslado anulado')) setAnulando(null);
          }}>Anular traslado</Button>
        </Group>
        {op.alerta}
      </Modal>
    </Stack>
  );
}

function FormularioRecepcion({ traslado, alTerminar }: { traslado: Traslado; alTerminar: () => void }) {
  const [decisiones, setDecisiones] = useState(traslado.items.map((i) => ({ itemId: i.id, aceptado: true, motivo: '' })));
  const [fecha, setFecha] = useState(hoy());
  const op = useOperacion();
  const cambiar = (i: number, c: Partial<(typeof decisiones)[number]>) => setDecisiones(decisiones.map((d, j) => (j === i ? { ...d, ...c } : d)));
  const faltaMotivo = decisiones.some((d) => !d.aceptado && !d.motivo.trim());
  return (
    <Stack>
      <Text size="sm">{traslado.cajaOrigen.nombre} ({traslado.cajaOrigen.sucursal}) → {traslado.cajaDestino.nombre} ({traslado.cajaDestino.sucursal})</Text>
      <TextInput label="Fecha de recepción" type="date" w={200} value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
      <Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Valor</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Recibido</Table.Th><Table.Th>Motivo del rechazo</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {traslado.items.map((it, i) => (
            <Table.Tr key={it.id}>
              <Table.Td>{descripcion(it)}</Table.Td><Table.Td ta="right">{formatoMoneda(it.importe, it.monedaCodigo)}</Table.Td>
              <Table.Td><Checkbox aria-label={`Recibido ${descripcion(it)}`} checked={decisiones[i].aceptado} onChange={(e) => cambiar(i, { aceptado: e.currentTarget.checked })} /></Table.Td>
              <Table.Td>{!decisiones[i].aceptado && <TextInput size="xs" aria-label="Motivo del rechazo" value={decisiones[i].motivo} onChange={(e) => cambiar(i, { motivo: e.currentTarget.value })} />}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {faltaMotivo && <Alert color="yellow">Indique el motivo de cada valor no recibido.</Alert>}
      <Group justify="flex-end">
        <Button loading={op.enviando} disabled={faltaMotivo} onClick={async () => {
          const r = await op.ejecutar(() => api(`/tesoreria/traslados/${traslado.id}/recibir`, {
            metodo: 'POST', body: { fecha, items: decisiones.map((d) => ({ itemId: d.itemId, aceptado: d.aceptado, motivo: d.aceptado ? null : d.motivo })) },
          }), () => `Traslado ${traslado.numero} recibido`);
          if (r) alTerminar();
        }}>Confirmar recepción</Button>
      </Group>
      {op.alerta}
    </Stack>
  );
}

export function RecepcionTrasladosPage() {
  const [elegido, setElegido] = useState<Traslado | null>(null);
  return (
    <>
      <TablaTraslados titulo="Recepción de traslados" estado="ENVIADO" onSeleccionar={setElegido} />
      <Modal opened={!!elegido} onClose={() => setElegido(null)} title={`Traslado ${elegido?.numero ?? ''}`} size="lg">
        {elegido && <FormularioRecepcion traslado={elegido} alTerminar={() => setElegido(null)} />}
      </Modal>
    </>
  );
}

export const ValoresEnTransitoPage = () => <TablaTraslados titulo="Valores en tránsito" estado="ENVIADO" />;
